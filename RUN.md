# Run CHAT locally and through a Cloudflare quick tunnel

## One command

This starts CHAT, creates the tunnel, and prints the public link:

```powershell
cd C:\path\to\CHAT
powershell -ExecutionPolicy Bypass -File .\scripts\start-public.ps1
```

Keep that window open and press `Ctrl+C` when finished.

## Manual two-window method

Open two PowerShell windows and keep both running.

## Window 1 — application server

```powershell
cd C:\path\to\CHAT
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8765
```

## Window 2 — public tunnel

Either use the helper:

```powershell
cd C:\path\to\CHAT
powershell -ExecutionPolicy Bypass -File .\scripts\start-tunnel.ps1
```

Or run Cloudflare directly:

```powershell
cloudflared tunnel --protocol http2 --url http://127.0.0.1:8765
```

Share the generated `https://...trycloudflare.com` address. It is temporary and
stops working when the tunnel process exits.
