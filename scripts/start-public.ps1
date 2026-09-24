$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$python = Join-Path $repoRoot ".venv\Scripts\python.exe"
$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
$localUrl = "http://127.0.0.1:8765"
$serverProcess = $null
$tunnelProcess = $null
$startedServer = $false
$logDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("chat-public-" + [guid]::NewGuid().ToString("N"))
$tunnelOutput = Join-Path $logDirectory "cloudflared-output.log"
$tunnelError = Join-Path $logDirectory "cloudflared-error.log"

if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    throw "Python virtual environment not found at $python. Create .venv and install requirements first."
}

if (-not $cloudflared) {
    throw "cloudflared is not installed or is not available on PATH."
}

function Test-ChatServer {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $localUrl -TimeoutSec 2
        return $response.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

try {
    if (-not (Test-ChatServer)) {
        Write-Host "Starting CHAT locally..." -ForegroundColor Cyan
        $serverProcess = Start-Process `
            -FilePath $python `
            -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8765") `
            -WorkingDirectory $repoRoot `
            -WindowStyle Hidden `
            -PassThru
        $startedServer = $true

        $serverDeadline = (Get-Date).AddSeconds(20)
        while (-not (Test-ChatServer) -and (Get-Date) -lt $serverDeadline) {
            if ($serverProcess.HasExited) {
                throw "Uvicorn stopped before CHAT became reachable."
            }
            Start-Sleep -Milliseconds 300
        }

        if (-not (Test-ChatServer)) {
            throw "CHAT did not become reachable at $localUrl within 20 seconds."
        }
    }
    else {
        Write-Host "CHAT is already running locally." -ForegroundColor Green
    }

    New-Item -ItemType Directory -Path $logDirectory | Out-Null
    Write-Host "Opening a temporary Cloudflare tunnel..." -ForegroundColor Cyan
    $tunnelProcess = Start-Process `
        -FilePath $cloudflared.Source `
        -ArgumentList @("tunnel", "--protocol", "http2", "--url", $localUrl) `
        -WorkingDirectory $repoRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $tunnelOutput `
        -RedirectStandardError $tunnelError `
        -PassThru

    $publicUrl = $null
    $tunnelDeadline = (Get-Date).AddSeconds(45)
    while (-not $publicUrl -and (Get-Date) -lt $tunnelDeadline) {
        if ($tunnelProcess.HasExited) {
            $details = ((Get-Content -LiteralPath $tunnelError -Raw -ErrorAction SilentlyContinue) +
                (Get-Content -LiteralPath $tunnelOutput -Raw -ErrorAction SilentlyContinue)).Trim()
            throw "cloudflared stopped before creating a tunnel. $details"
        }

        $logText = (Get-Content -LiteralPath $tunnelError -Raw -ErrorAction SilentlyContinue) +
            (Get-Content -LiteralPath $tunnelOutput -Raw -ErrorAction SilentlyContinue)
        $match = [regex]::Match($logText, "https://[a-z0-9-]+\.trycloudflare\.com")
        if ($match.Success) {
            $publicUrl = $match.Value
            break
        }
        Start-Sleep -Milliseconds 250
    }

    if (-not $publicUrl) {
        throw "Timed out waiting for Cloudflare to create a public URL."
    }

    Write-Host ""
    Write-Host "CHAT is public:" -ForegroundColor Green
    Write-Host $publicUrl -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Keep this window open. Press Ctrl+C to stop the tunnel." -ForegroundColor Cyan

    while (-not $tunnelProcess.HasExited) {
        Start-Sleep -Seconds 1
    }
}
finally {
    if ($tunnelProcess -and -not $tunnelProcess.HasExited) {
        Stop-Process -Id $tunnelProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($startedServer -and $serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    }
    foreach ($logFile in @($tunnelOutput, $tunnelError)) {
        if (Test-Path -LiteralPath $logFile) {
            Remove-Item -LiteralPath $logFile -Force -ErrorAction SilentlyContinue
        }
    }
    if (Test-Path -LiteralPath $logDirectory) {
        Remove-Item -LiteralPath $logDirectory -Force -ErrorAction SilentlyContinue
    }
}
