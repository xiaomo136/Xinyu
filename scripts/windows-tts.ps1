param(
  [Parameter(Mandatory = $true)]
  [string]$Text,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath,

  [string]$VoiceHint = "Chinese",
  [int]$Rate = 0,
  [int]$Volume = 100
)

$directory = Split-Path -Parent $OutputPath
if (-not (Test-Path $directory)) {
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

$voice = New-Object -ComObject SAPI.SpVoice
$stream = New-Object -ComObject SAPI.SpFileStream

try {
  $voices = @($voice.GetVoices())
  $matchedVoice = $null

  foreach ($item in $voices) {
    $description = $item.GetDescription()
    if ($description -like "*$VoiceHint*" -or $description -like "*Chinese*" -or $description -like "*ZH*") {
      $matchedVoice = $item
      break
    }
  }

  if ($matchedVoice) {
    $voice.Voice = $matchedVoice
  }

  $voice.Rate = $Rate
  $voice.Volume = $Volume
  $stream.Open($OutputPath, 3, $false)
  $voice.AudioOutputStream = $stream
  [void]$voice.Speak($Text)
}
finally {
  if ($stream) {
    $stream.Close()
  }
}
