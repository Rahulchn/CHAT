import sqlite3
from io import BytesIO
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image, PngImagePlugin
from starlette.websockets import WebSocketDisconnect

from app.main import create_app


@pytest.fixture
def database_url(tmp_path):
    return f"sqlite+aiosqlite:///{tmp_path / 'group.db'}"


def join(socket, name="Alice", client_id=None):
    client_id = client_id or str(uuid4())
    socket.send_json({"type": "join", "name": name, "client_id": client_id})
    welcome = socket.receive_json()
    assert welcome["type"] == "welcome"
    assert socket.receive_json()["type"] == "presence"
    return welcome


def next_message(socket):
    for _ in range(10):
        payload = socket.receive_json()
        if payload["type"] == "message":
            return payload["message"]
    raise AssertionError("No message received")


def test_three_people_broadcast_and_sender_binding(database_url):
    with TestClient(create_app(database_url)) as client:
        with client.websocket_connect("/ws") as alice:
            welcome = join(alice, "  Alice   Smith  ")
            assert welcome["name"] == "Alice Smith"
            with client.websocket_connect("/ws") as bob, client.websocket_connect("/ws") as carol:
                join(bob, "Bob")
                join(carol, "कारोल")
                alice.send_json({"type": "message", "body": "Hello everyone", "name": "Fake", "client_id": str(uuid4())})
                copies = [next_message(socket) for socket in (alice, bob, carol)]
                assert copies[0] == copies[1] == copies[2]
                assert copies[0]["name"] == "Alice Smith"
                assert copies[0]["client_id"] == welcome["client_id"]
                assert copies[0]["created_at"].endswith("+00:00")
                assert client.get("/api/messages").json()["messages"] == [copies[0]]


def test_persistence_restart_and_offline_catchup(database_url):
    client_id = str(uuid4())
    with TestClient(create_app(database_url)) as client:
        with client.websocket_connect("/ws") as socket:
            join(socket, client_id=client_id)
            socket.send_json({"type": "message", "body": "Saved"})
            saved = next_message(socket)
        with client.websocket_connect("/ws") as other:
            join(other, "Bob")
            other.send_json({"type": "message", "body": "While Alice was away"})
            next_message(other)
    with TestClient(create_app(database_url)) as client:
        with client.websocket_connect("/ws") as socket:
            history = join(socket, client_id=client_id)["messages"]
            assert history[0] == saved
            assert [m["body"] for m in history] == ["Saved", "While Alice was away"]


def test_invalid_join_and_message_recovery(database_url):
    with TestClient(create_app(database_url)) as client:
        for name in [" ", "x" * 41]:
            with client.websocket_connect("/ws") as socket:
                socket.send_json({"type": "join", "name": name, "client_id": str(uuid4())})
                assert socket.receive_json()["type"] == "error"
                with pytest.raises(WebSocketDisconnect) as error:
                    socket.receive_json()
                assert error.value.code == 1008
        with client.websocket_connect("/ws") as socket:
            socket.send_json({"type": "message", "body": "not joined"})
            assert socket.receive_json()["type"] == "error"
        with client.websocket_connect("/ws") as socket:
            join(socket)
            socket.send_text("invalid json")
            assert socket.receive_json()["type"] == "error"
            for body in ["  ", "a" * 2001]:
                socket.send_json({"type": "message", "body": body})
                assert socket.receive_json()["type"] == "error"
            socket.send_json({"type": "message", "body": "Still connected"})
            assert next_message(socket)["body"] == "Still connected"
            assert len(client.get("/api/messages").json()["messages"]) == 1


def test_history_pagination_and_presence(database_url):
    with TestClient(create_app(database_url)) as client:
        with client.websocket_connect("/ws") as alice:
            join(alice)
            with client.websocket_connect("/ws") as bob:
                join(bob)
                assert alice.receive_json() == {"type": "presence", "count": 2}
            assert alice.receive_json() == {"type": "presence", "count": 1}
            for body in ["one", "two", "three"]:
                alice.send_json({"type": "message", "body": body})
                next_message(alice)
        latest = client.get("/api/messages?limit=2").json()
        assert latest["has_more"] is True
        assert [m["body"] for m in latest["messages"]] == ["two", "three"]
        older = client.get(f"/api/messages?limit=2&before_id={latest['messages'][0]['id']}").json()
        assert older["has_more"] is False
        assert [m["body"] for m in older["messages"]] == ["one"]
        assert client.get("/api/messages?limit=201").status_code == 422


def test_legacy_private_data_not_published(tmp_path):
    path = tmp_path / "legacy.db"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT)")
        db.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, body TEXT)")
        db.execute("INSERT INTO users VALUES (1, 'old_account', 'old_hash')")
        db.execute("INSERT INTO messages VALUES (1, 'PRIVATE')")
    with TestClient(create_app(f"sqlite+aiosqlite:///{path}")) as client:
        assert client.get("/api/messages").json() == {"messages": [], "has_more": False}
        for route in ["/api/users", "/api/me", "/api/messages/1"]:
            assert client.get(route).status_code == 404
        for route in ["/api/login", "/api/register"]:
            assert client.post(route, json={}).status_code == 404
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT body FROM messages").fetchone()[0] == "PRIVATE"


def test_avatar_is_bound_to_join_and_persisted(database_url):
    with TestClient(create_app(database_url)) as client:
        with client.websocket_connect("/ws") as socket:
            socket.send_json({"type": "join", "name": "Alex", "client_id": str(uuid4()), "avatar": "doge"})
            assert socket.receive_json()["avatar"] == "doge"
            socket.receive_json()
            socket.send_json({"type": "message", "body": "My chosen avatar", "avatar": "wave"})
            assert next_message(socket)["avatar"] == "doge"
        with client.websocket_connect("/ws") as socket:
            socket.send_json({"type": "join", "name": "Alex", "client_id": str(uuid4()), "avatar": "../../bad"})
            assert socket.receive_json()["type"] == "error"
    with TestClient(create_app(database_url)) as client:
        assert client.get("/api/messages").json()["messages"][0]["avatar"] == "doge"


def test_avatar_migration_preserves_existing_group_messages(tmp_path):
    path = tmp_path / "before_avatars.db"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE group_messages (id INTEGER PRIMARY KEY, client_id VARCHAR(36), name VARCHAR(40), body TEXT, created_at DATETIME)")
        db.execute("INSERT INTO group_messages VALUES (1, ?, 'Alex', 'Keep this message', '2026-09-22 12:00:00')", (str(uuid4()),))
    for _ in range(2):
        with TestClient(create_app(f"sqlite+aiosqlite:///{path}")) as client:
            message = client.get("/api/messages").json()["messages"][0]
            assert message["body"] == "Keep this message"
            assert message["avatar"] == "orbit"
            assert message["image_url"] is None


def test_image_upload_message_and_metadata_removal(database_url, tmp_path):
    upload_dir = tmp_path / "uploads"
    source = BytesIO()
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("Location", "private-place")
    Image.new("RGB", (24, 18), (120, 40, 200)).save(source, format="PNG", pnginfo=metadata)

    with TestClient(create_app(database_url, upload_dir)) as client:
        response = client.post("/api/uploads", content=source.getvalue(), headers={"Content-Type": "image/png"})
        assert response.status_code == 201
        image_url = response.json()["image_url"]
        assert image_url.startswith("/api/uploads/") and image_url.endswith(".png")

        downloaded = client.get(image_url)
        assert downloaded.status_code == 200
        assert downloaded.headers["content-type"] == "image/png"
        assert downloaded.headers["x-content-type-options"] == "nosniff"
        with Image.open(BytesIO(downloaded.content)) as saved:
            assert saved.size == (24, 18)
            assert "Location" not in saved.info

        with client.websocket_connect("/ws") as socket:
            join(socket)
            socket.send_json({"type": "message", "body": "A picture", "image_url": image_url})
            message = next_message(socket)
            assert message["body"] == "A picture"
            assert message["image_url"] == image_url

            socket.send_json({"type": "message", "body": "", "image_url": "https://example.com/image.png"})
            assert socket.receive_json()["type"] == "error"
            socket.send_json({"type": "message", "body": "", "image_url": "/api/uploads/" + "0" * 32 + ".png"})
            assert socket.receive_json()["message"] == "That uploaded image is no longer available."

        assert client.get("/api/messages").json()["messages"][0]["image_url"] == image_url


def test_image_upload_rejects_unsafe_and_oversized_files(database_url, tmp_path):
    with TestClient(create_app(database_url, tmp_path / "uploads")) as client:
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        assert client.post("/api/uploads", content=svg, headers={"Content-Type": "image/svg+xml"}).status_code == 415
        fake_png = b"\x89PNG\r\n\x1a\nnot-an-image"
        assert client.post("/api/uploads", content=fake_png, headers={"Content-Type": "image/png"}).status_code == 415
        oversized = b"\x89PNG\r\n\x1a\n" + b"x" * (5 * 1024 * 1024)
        assert client.post("/api/uploads", content=oversized, headers={"Content-Type": "image/png"}).status_code == 413
