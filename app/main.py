import asyncio
from contextlib import asynccontextmanager
from datetime import timezone
from pathlib import Path

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from .config import DATABASE_URL
from .database import Database
from .models import GroupMessage
from .schemas import JoinRoom, OutgoingMessage


STATIC_DIR = Path(__file__).parent / "static"


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


def create_app(database_url: str | None = None) -> FastAPI:
    database = Database(database_url or DATABASE_URL)
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

    @application.get("/", include_in_schema=False)
    async def index():
        return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})

    @application.get("/api/messages")
    async def history(
        limit: int = Query(100, ge=1, le=200),
        before_id: int | None = Query(None, ge=1),
    ):
        return await get_history(database, limit, before_id)

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
                        await room.send(socket, {"type": "error", "message": "Send a message between 1 and 2,000 characters."})
                    continue

                async with room.lock:
                    try:
                        async with database.sessions() as session:
                            message = GroupMessage(
                                client_id=str(member.client_id), name=member.name,
                                avatar=member.avatar, body=outgoing.body,
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
