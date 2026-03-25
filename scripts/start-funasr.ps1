param(
  [string]$PythonPath = "C:\Users\ROG\AppData\Local\Programs\Python\Python311\python.exe"
)

Set-Location $PSScriptRoot\..
& $PythonPath tools\funasr_bridge.py
