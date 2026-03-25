param(
  [Parameter(Mandatory = $true)]
  [string]$PythonPath,

  [Parameter(Mandatory = $true)]
  [string]$TextFile,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath,

  [string]$VoiceHint = "Chinese",
  [int]$Rate = 150,
  [double]$Volume = 1.0
)

Set-Location $PSScriptRoot\..
& $PythonPath tools\windows_tts.py --text-file $TextFile --output $OutputPath --voice-hint $VoiceHint --rate $Rate --volume $Volume
