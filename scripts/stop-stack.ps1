$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $root '.runtime'
$qdrantPidFile = Join-Path $runtimeDir 'qdrant.pid'
$serverPidFile = Join-Path $runtimeDir 'server.pid'
$clientPidFile = Join-Path $runtimeDir 'client.pid'
$dockerComposeFile = Join-Path $root 'docker-compose.yml'
$localQdrantExe = Join-Path $root 'tools\qdrant\current\qdrant.exe'

function Stop-TrackedProcess($pidFile) {
    if (-not (Test-Path $pidFile)) { return }
    $raw = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($raw) {
        $trackedPid = 0
        if ([int]::TryParse($raw, [ref]$trackedPid)) {
            Stop-Process -Id $trackedPid -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

function Stop-PortListener($port) {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($procId in ($listeners | Where-Object { $_ })) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
}

Stop-TrackedProcess $qdrantPidFile
Stop-TrackedProcess $serverPidFile
Stop-TrackedProcess $clientPidFile
Stop-PortListener 6333
Stop-PortListener 6334
Stop-PortListener 8000
Stop-PortListener 5173

if ((-not (Test-Path $localQdrantExe)) -and (Test-Path $dockerComposeFile)) {
    try {
        docker compose -f $dockerComposeFile stop qdrant | Out-Host
    } catch {
        Write-Host '[stack] failed to stop Qdrant via docker compose'
    }
}

Write-Host '[stack] stopped qdrant, backend, and frontend'
