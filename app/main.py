import asyncio
from contextlib import asynccontextmanager
from datetime import timezone
from io import BytesIO
from pathlib import Path
from uuid import uuid4
import warnings

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, ImageSequence, UnidentifiedImageError
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from .config import DATABASE_URL
from .database import Database
from .models import GroupMessage
from .schemas import JoinRoom, OutgoingMessage


STATIC_DIR = Path(__file__).parent / "static"
DEFAULT_UPLOAD_DIR = Path(__file__).parent.parent / "uploads"
MAX_IMAGE_BYTES = 5 * 1024 * 1024
IMAGE_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "webp": "image/webp",
    "gif": "image/gif",
}


def detect_image_type(data: bytes) -> tuple[str, str] | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", IMAGE_TYPES["png"]
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg", IMAGE_TYPES["jpg"]
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp", IMAGE_TYPES["webp"]
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "gif", IMAGE_TYPES["gif"]
    return None


def sanitize_image(data: bytes, extension: str) -> bytes:
    """Decode and re-encode an image to validate it and remove embedded metadata."""
    expected_format = {"png": "PNG", "jpg": "JPEG", "webp": "WEBP", "gif": "GIF"}[extension]
    output = BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(BytesIO(data)) as source:
            if source.format != expected_format:
                raise ValueError("Image format does not match its signature")
            if source.width * source.height > 25_000_000:
                raise ValueError("Image dimensions are too large")

            if expected_format == "GIF" and getattr(source, "is_animated", False):
                frame_count = getattr(source, "n_frames", 1)
                if frame_count > 200 or source.width * source.height * frame_count > 50_000_000:
                    raise ValueError("Animated image is too large")
                frames = [frame.convert("RGBA") for frame in ImageSequence.Iterator(source)]
                durations = [frame.info.get("duration", 100) for frame in ImageSequence.Iterator(source)]
                frames[0].save(
                    output, format="GIF", save_all=True, append_images=frames[1:],
                    duration=durations, loop=source.info.get("loop", 0), disposal=2,
                )
            else:
                image = ImageOps.exif_transpose(source)
                if expected_format == "JPEG":
                    image.convert("RGB").save(output, format="JPEG", quality=88, optimize=True)
                elif expected_format == "PNG":
                    image.save(output, format="PNG", optimize=True)
                elif expected_format == "WEBP":
                    if getattr(source, "is_animated", False):
                        raise ValueError("Animated WebP is not supported; use GIF instead")
                    image.save(output, format="WEBP", quality=86, method=4)
                else:
                    image.save(output, format="GIF", optimize=True)
    return output.getvalue()


def message_json(message: GroupMessage) -> dict:
    created_at = message.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return {
        "id": message.id,
        "client_id": message.client_id,
        "name": message.name,
        "avatar": message.avatar,
        "body": message.body,
        "image_url": message.image_url,
        "created_at": created_at.isoformat(),
    }


async def get_history(database: Database, limit: int = 100, before_id: int | None = None) -> dict:
    query = select(GroupMessage).order_by(GroupMessage.id.desc()).limit(limit + 1)
    if before_id is not None:
        query = query.where(GroupMessage.id < before_id)
    async with database.sessions() as session:
        rows = list(await session.scalars(query))
    return {
        "messages": [message_json(row) for row in reversed(rows[:limit])],
        "has_more": len(rows) > limit,
    }


class GroupRoom:
    """One in-process room. The lock orders history snapshots and committed messages."""

    def __init__(self) -> None:
        self.members: set[WebSocket] = set()
        self.lock = asyncio.Lock()

    async def send(self, socket: WebSocket, payload: dict) -> bool:
        try:
            await asyncio.wait_for(socket.send_json(payload), timeout=3)
            return True
        except (TimeoutError, OSError, RuntimeError, WebSocketDisconnect):
            self.members.discard(socket)
            return False

    async def broadcast(self, payload: dict) -> None:
        # Concurrent sends keep one slow browser from delaying every other browser.
        await asyncio.gather(*(self.send(socket, payload) for socket in list(self.members)))

    async def presence(self) -> None:
        await self.broadcast({"type": "presence", "count": len(self.members)})


def create_app(database_url: str | None = None, upload_dir: Path | None = None) -> FastAPI:
    database = Database(database_url or DATABASE_URL)
    uploads = (upload_dir or DEFAULT_UPLOAD_DIR).resolve()
    room = GroupRoom()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        await database.create_tables()
        try:
            yield
        finally:
            await database.engine.dispose()

    application = FastAPI(title="Chatter · Group Chat", lifespan=lifespan)
    application.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @application.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @application.get("/", include_in_schema=False)
    async def index():
        return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})

    @application.get("/api/messages")
    async def history(
        limit: int = Query(100, ge=1, le=200),
        before_id: int | None = Query(None, ge=1),
    ):
        return await get_history(database, limit, before_id)

    @application.post("/api/uploads", status_code=201)
    async def upload_image(request: Request):
        declared_type = request.headers.get("content-type", "").split(";", 1)[0].lower()
        if declared_type not in IMAGE_TYPES.values():
            raise HTTPException(415, "Choose a PNG, JPEG, WebP, or GIF image.")

        declared_length = request.headers.get("content-length")
        if declared_length and declared_length.isdigit() and int(declared_length) > MAX_IMAGE_BYTES:
            raise HTTPException(413, "Images must be 5 MB or smaller.")

        contents = bytearray()
        async for chunk in request.stream():
            if len(contents) + len(chunk) > MAX_IMAGE_BYTES:
                raise HTTPException(413, "Images must be 5 MB or smaller.")
            contents.extend(chunk)
        if not contents:
            raise HTTPException(400, "The uploaded image is empty.")

        detected = detect_image_type(bytes(contents))
        if detected is None or detected[1] != declared_type:
            raise HTTPException(415, "The file contents do not match a supported image type.")

        extension, media_type = detected
        try:
            sanitized = await asyncio.to_thread(sanitize_image, bytes(contents), extension)
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise HTTPException(415, "The image is damaged, unsafe, or unsupported.") from None
        if len(sanitized) > MAX_IMAGE_BYTES:
            raise HTTPException(413, "The processed image is larger than 5 MB.")
        filename = f"{uuid4().hex}.{extension}"
        uploads.mkdir(parents=True, exist_ok=True)
        destination = uploads / filename
        await asyncio.to_thread(destination.write_bytes, sanitized)
        return {"image_url": f"/api/uploads/{filename}", "media_type": media_type}

    @application.get("/api/uploads/{filename}", include_in_schema=False)
    async def uploaded_image(filename: str):
        stem, separator, extension = filename.partition(".")
        if (
            separator != "." or len(stem) != 32
            or any(char not in "0123456789abcdef" for char in stem)
            or extension not in IMAGE_TYPES
        ):
            raise HTTPException(404)
        path = uploads / filename
        if not path.is_file():
            raise HTTPException(404)
        return FileResponse(
            path,
            media_type=IMAGE_TYPES[extension],
            headers={"Cache-Control": "public, max-age=31536000, immutable"},
        )

    @application.websocket("/ws")
    async def websocket_chat(socket: WebSocket):
        await socket.accept()
        try:
            # Names are display labels, not accounts or verified identities.
            try:
                raw = await asyncio.wait_for(socket.receive_text(), timeout=15)
                member = JoinRoom.model_validate_json(raw)
            except (ValidationError, ValueError, TimeoutError, KeyError):
                await room.send(socket, {"type": "error", "message": "Enter a name between 1 and 40 characters to join."})
                await socket.close(code=1008)
                return

            async with room.lock:
                snapshot = await get_history(database)
                if not await room.send(socket, {
                    "type": "welcome", "name": member.name,
                    "avatar": member.avatar,
                    "client_id": str(member.client_id), **snapshot,
                }):
                    return
                room.members.add(socket)
                await room.presence()

            while True:
                raw = await socket.receive_text()
                try:
                    outgoing = OutgoingMessage.model_validate_json(raw)
                except (ValidationError, ValueError):
                    async with room.lock:
                        await room.send(socket, {"type": "error", "message": "Send text, an uploaded image, or both."})
                    continue

                if outgoing.image_url:
                    image_name = outgoing.image_url.rsplit("/", 1)[-1]
                    if not (uploads / image_name).is_file():
                        async with room.lock:
                            await room.send(socket, {"type": "error", "message": "That uploaded image is no longer available."})
                        continue

                async with room.lock:
                    try:
                        async with database.sessions() as session:
                            message = GroupMessage(
                                client_id=str(member.client_id), name=member.name,
                                avatar=member.avatar, body=outgoing.body,
                                image_url=outgoing.image_url,
                            )
                            session.add(message)
                            await session.commit()
                            await session.refresh(message)
                    except SQLAlchemyError:
                        await room.send(socket, {"type": "error", "message": "Your message could not be saved. Please try again."})
                        continue
                    await room.broadcast({"type": "message", "message": message_json(message)})
        except (WebSocketDisconnect, OSError):
            pass
        except KeyError:
            # Binary frames are not part of this text-only protocol.
            await room.send(socket, {"type": "error", "message": "Only text messages are supported."})
            await socket.close(code=1003)
        finally:
            async with room.lock:
                if socket in room.members:
                    room.members.discard(socket)
                    await room.presence()

    return application


app = create_app()
