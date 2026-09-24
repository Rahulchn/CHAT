$ErrorActionPreference = "Stop"

$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) {
    throw "cloudflared is not installed or is not available on PATH. Install it, then rerun this script."
}

$localUrl = "http://127.0.0.1:8765"

try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $localUrl -TimeoutSec 4
    if ($response.StatusCode -ne 200) {
        throw "CHAT returned HTTP $($response.StatusCode)."
    }
}
catch {
    throw "CHAT is not reachable at $localUrl. Start Uvicorn in another PowerShell window before opening the tunnel. $($_.Exception.Message)"
}

Write-Host "CHAT is running locally. Starting a temporary Cloudflare tunnel..." -ForegroundColor Green
Write-Host "Keep this window open and share the trycloudflare.com URL shown below." -ForegroundColor Cyan

& $cloudflared.Source tunnel --protocol http2 --url $localUrl
