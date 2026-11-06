param([switch]$NoBrowser, [switch]$Stop)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$serviceScript = Join-Path $PSScriptRoot 'local-service.mjs'
$logDirectory = Join-Path $projectRoot 'logs\local'
$stateFile = Join-Path $logDirectory 'services.json'
$null = New-Item -ItemType Directory -Path $logDirectory -Force

function Get-OwnedProcess($record) {
  if (!$record -or !$record.pid -or !$record.created) { return $null }
  $candidate = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$record.pid) -ErrorAction SilentlyContinue
  if (!$candidate -or $candidate.Name -ne 'node.exe' -or !$candidate.CommandLine) { return $null }
  if ($candidate.CreationDate.ToUniversalTime().ToString('o') -ne $record.created) { return $null }
  if (!$candidate.CommandLine.Contains(('"' + $serviceScript + '" ' + $record.service))) { return $null }
  return $candidate
}

function Test-Health([string]$service) {
  try {
    if ($service -eq 'rooms') {
      return (Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health' -TimeoutSec 2).ok -eq $true
    }
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:5174/' -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200 -and $response.Content.Contains('<title>SignBridge')
  } catch { return $false }
}

try {
  $records = @()
  if (Test-Path -LiteralPath $stateFile) {
    try { $records = @(Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json) } catch { $records = @() }
  }
  if ($Stop) {
    foreach ($record in $records) {
      $owned = Get-OwnedProcess $record
      if ($owned) { Stop-Process -Id $owned.ProcessId -Force; Write-Host ('Stopped SignBridge ' + $record.service + '.') }
    }
    '[]' | Set-Content -LiteralPath $stateFile -Encoding UTF8
    Write-Host 'Stopped services started by this launcher. Other processes were left alone.'
    exit 0
  }

  $nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
  $nodeVersion = & $nodeExecutable -p 'process.versions.node'
  if ([version]$nodeVersion -lt [version]'22.12.0') { throw 'Node 22.12 or newer is required.' }
  if (!(Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\vite\package.json'))) {
    throw 'Dependencies are missing. Open a terminal in SignBridge, run npm ci, then launch again.'
  }
  foreach ($service in @('rooms', 'web')) {
    if (Test-Health $service) { Write-Host ('SignBridge ' + $service + ' is already ready.'); continue }
    $record = $records | Where-Object service -eq $service | Select-Object -First 1
    $owned = Get-OwnedProcess $record
    if (!$owned) {
      $arguments = @()
      if ($service -eq 'rooms') { $arguments += '--env-file-if-exists=.env.local' }
      $arguments += @(('"' + $serviceScript + '"'), $service)
      $started = Start-Process -FilePath $nodeExecutable -ArgumentList $arguments -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory ($service + '.out.log')) -RedirectStandardError (Join-Path $logDirectory ($service + '.err.log')) -PassThru
      $candidate = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $started.Id)
      if (!$candidate) { throw ('SignBridge ' + $service + ' exited. See ' + $logDirectory) }
      $records = @($records | Where-Object service -ne $service) + @([pscustomobject]@{
        service = $service; pid = $started.Id; created = $candidate.CreationDate.ToUniversalTime().ToString('o')
      })
      ConvertTo-Json -InputObject @($records) | Set-Content -LiteralPath $stateFile -Encoding UTF8
      $owned = $candidate
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(45)
    while (!(Test-Health $service)) {
      if (!(Get-Process -Id $owned.ProcessId -ErrorAction SilentlyContinue)) { throw ('SignBridge ' + $service + ' exited. See ' + $logDirectory) }
      if ([DateTime]::UtcNow -ge $deadline) { throw ('SignBridge ' + $service + ' did not become ready. See ' + $logDirectory) }
      Start-Sleep -Milliseconds 250
    }
    Write-Host ('SignBridge ' + $service + ' is ready.')
  }
  Write-Host 'Ready: http://127.0.0.1:5174/#trained-sign'
  Write-Host ('Logs: ' + $logDirectory)
  Write-Host 'Double-click stop-signbridge.cmd when finished.'
  if (!$NoBrowser) { Start-Process 'http://127.0.0.1:5174/#trained-sign' -WindowStyle Hidden }
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
