$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $root '.runtime'
$qdrantPidFile = Join-Path $runtimeDir 'qdrant.pid'
$serverPidFile = Join-Path $runtimeDir 'server.pid'
$clientPidFile = Join-Path $runtimeDir 'client.pid'
$dockerComposeFile = Join-Path $root 'docker-compose.yml'
$localQdrantExe = Join-Path $root 'tools\qdrant\current\qdrant.exe'

function Show-TrackedProcess($name, $pidFile, $port, $url) {
    $pidText = if (Test-Path $pidFile) { (Get-Content $pidFile | Select-Object -First 1) } else { '' }
    $state = 'stopped'
    $procName = ''
    $trackedPid = 0
    if ($pidText) {
        if ([int]::TryParse($pidText, [ref]$trackedPid)) {
            $proc = Get-Process -Id $trackedPid -ErrorAction SilentlyContinue
            if ($proc) {
                $state = 'running'
                $procName = $proc.ProcessName
            }
        }
    }
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    $listening = if ($listener) { 'yes' } else { 'no' }
    if ($listener -and $state -ne 'running') {
        $proc = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
        if ($proc) {
            $state = 'running'
            $procName = $proc.ProcessName
            $trackedPid = $listener.OwningProcess
            $pidText = [string]$trackedPid
        }
    }
    $pidDisplay = if ([string]::IsNullOrWhiteSpace($pidText)) { '-' } else { $pidText }
    $procDisplay = if ([string]::IsNullOrWhiteSpace($procName)) { '-' } else { $procName }
    Write-Host ("[{0}] state={1} pid={2} process={3} port={4} listening={5} url={6}" -f $name, $state, $pidDisplay, $procDisplay, $port, $listening, $url)
}

function Show-QdrantStatus() {
    $state = 'stopped'
    $container = '-'
    $mode = if (Test-Path $localQdrantExe) { 'local' } elseif (Test-Path $dockerComposeFile) { 'docker' } else { 'missing' }
    if ($mode -eq 'local') {
        $pidText = if (Test-Path $qdrantPidFile) { (Get-Content $qdrantPidFile | Select-Object -First 1) } else { '' }
        if ($pidText) {
            $trackedPid = 0
            if ([int]::TryParse($pidText, [ref]$trackedPid)) {
                $proc = Get-Process -Id $trackedPid -ErrorAction SilentlyContinue
                if ($proc) {
                    $state = 'running'
                    $container = $trackedPid
                }
            }
        }
        if ($state -ne 'running') {
            $listener = Get-NetTCPConnection -LocalPort 6333 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($listener) {
                $proc = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
                if ($proc -and $proc.ProcessName -like 'qdrant*') {
                    $state = 'running'
                    $container = $proc.Id
                }
            }
        }
    } elseif ($mode -eq 'docker') {
        try {
            $container = (docker compose -f $dockerComposeFile ps -q qdrant 2>$null | Select-Object -First 1)
            if ($container) {
                $running = docker inspect -f "{{.State.Status}}" $container 2>$null
                if ($running) { $state = $running.Trim() }
            } else {
                $state = 'stopped'
            }
        } catch {
            $state = 'error'
        }
    }
    $reachable = 'no'
    try {
        $resp = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:6333/collections' -TimeoutSec 2
        if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
            $reachable = 'yes'
        }
    } catch {
    }
    $containerDisplay = if ([string]::IsNullOrWhiteSpace($container)) { '-' } else { $container }
    Write-Host ("[qdrant] mode={0} state={1} id={2} reachable={3} url={4}" -f $mode, $state, $containerDisplay, $reachable, 'http://127.0.0.1:6333')
}

Show-QdrantStatus
Show-TrackedProcess 'backend' $serverPidFile 8000 'http://localhost:8000'
Show-TrackedProcess 'frontend' $clientPidFile 5173 'http://localhost:5173'
