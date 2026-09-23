cd C:\Users\rahul\Desktop\Chat
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8765

#----------------------

cloudflared tunnel --url http://localhost:8765