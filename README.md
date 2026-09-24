# Chatter — one shared group chat

Enter a display name and join the room. Everyone sees the same conversation, with live messages and saved history. There are no passwords, accounts, or login tokens.

Choose from eight locally stored photo and meme avatars before joining. Your avatar appears in the room and is saved with each message. The earlier illustrated avatars remain available for displaying old messages, without deleting history. The interface adapts from a desktop sidebar to a full-screen phone layout.

Built with Python FastAPI, native WebSockets, async SQLAlchemy, SQLite, and plain HTML/CSS/JavaScript.

## Run locally

```powershell
cd C:\path\to\CHAT
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8765
```

Open http://127.0.0.1:8765 in two tabs and enter a name in each. Messages appear in both tabs. The name field is remembered for convenience; each visit starts at the join screen. Leaving the room returns to that screen. The most recent 100 messages load on joining, and older history can be loaded in the room.

For friends on the same Wi-Fi, run with `--host 0.0.0.0` instead, then share `http://YOUR-PC-IP:8765`. The PC and server must stay running. This does not publish the app on the internet.

## Share temporarily over the internet

The project includes a one-command launcher that starts CHAT, creates a temporary
Cloudflare Quick Tunnel, and prints the public URL:

```powershell
cd C:\path\to\CHAT
powershell -ExecutionPolicy Bypass -File .\scripts\start-public.ps1
```

Keep that PowerShell window open and press `Ctrl+C` to stop the tunnel. If CHAT
was not already running, the launcher stops its hidden Uvicorn process too.

For the manual method, start the application server in one PowerShell window:

```powershell
cd C:\path\to\CHAT
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8765
```

In a second PowerShell window, start the tunnel:

```powershell
cd C:\path\to\CHAT
powershell -ExecutionPolicy Bypass -File .\scripts\start-tunnel.ps1
```

The script checks that CHAT is reachable locally, then runs:

```powershell
cloudflared tunnel --protocol http2 --url http://127.0.0.1:8765
```

Share the generated `https://...trycloudflare.com` URL. Keep both PowerShell
windows open. Quick Tunnel URLs are temporary, have no uptime guarantee, and
change whenever a new tunnel is created. The explicit HTTP/2 protocol avoids
networks that block outbound QUIC traffic, while `127.0.0.1` avoids Windows
resolving `localhost` to an IPv6 listener that Uvicorn may not be using.

## Data and configuration

- `DATABASE_URL` defaults to `sqlite+aiosqlite:///./chat.db`, relative to the working directory. Start from this project directory to keep using the same database.
- Group messages use a separate `group_messages` table. Existing account and private-message tables are left intact, but are no longer read or exposed by the app. Private conversations are not copied into the group room.
- All new group messages and history are available to everyone who can reach this app. Display names are not verified or reserved; two visitors may use the same name. The browser's per-tab ID only styles its own messages and is not authentication.
- For PostgreSQL later, install `asyncpg` and set `DATABASE_URL` to your PostgreSQL connection string. Keep credentials in a local `.env` file and never commit it. This changes the database connection; existing SQLite data is not automatically transferred.
- Run one server worker. Room broadcast and online counts live in that process. Multiple workers would require a shared event layer.
- The new avatar images came from third-party URLs supplied for this project. Check their reuse rights before publicly distributing or hosting the app.

## Tests

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
```

Tests use isolated databases. If Windows blocks the default temporary directory, pass `--basetemp=.pytest-tmp` (pytest uses and clears that test-only folder).

## Protocol

Connect to `/ws`, then send `{"type":"join","name":"Rahul","client_id":"a-valid-uuid"}`. The welcome event includes group history; presence events report connected browsers. Send `{"type":"message","body":"Hello everyone!"}` to publish a message. The server uses the name bound at joining and broadcasts only after saving the message. Errors are displayed without discarding the draft.

`GET /api/messages?limit=100&before_id=123` returns older public group messages in chronological order with a `has_more` flag. Authentication and direct-message endpoints have been removed.
