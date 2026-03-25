param(
  [string]$PythonPath = "C:\Users\ROG\AppData\Local\Programs\Python\Python311\python.exe"
)

$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
Set-Location $rootDir

$config = Get-Content ".\config\app.config.json" -Raw | ConvertFrom-Json

function Test-HttpReady {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url
  )

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  } catch {
    return $false
  }
}

if ($config.providers.asr.type -eq "funasr") {
  $funasrBaseUrl = $config.providers.asr.funasr.baseUrl.TrimEnd("/")
  $healthUrl = "$funasrBaseUrl/health"

  if (-not (Test-HttpReady -Url $healthUrl)) {
    Write-Host "[xinyu] FunASR is not ready. Starting bridge in background..."
    $scriptPath = Join-Path $PSScriptRoot "start-funasr.ps1"
    Start-Process powershell -WindowStyle Hidden -ArgumentList @(
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      $scriptPath,
      "-PythonPath",
      $PythonPath
    ) | Out-Null

    $ready = $false
    for ($index = 0; $index -lt 15; $index += 1) {
      Start-Sleep -Seconds 1
      if (Test-HttpReady -Url $healthUrl) {
        $ready = $true
        break
      }
    }

    if ($ready) {
      Write-Host "[xinyu] FunASR is ready."
    } else {
      Write-Warning "[xinyu] FunASR startup timed out. Web will continue to launch."
    }
  } else {
    Write-Host "[xinyu] FunASR is already running."
  }
}

Write-Host "[xinyu] Starting web server..."
node .\server\index.js
