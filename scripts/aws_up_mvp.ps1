param(
  [string]$Region = "ap-south-1",
  [int]$ApiDesiredCount = 1,
  [int]$WorkerDesiredCount = 1
)

$ErrorActionPreference = "Stop"

Write-Host "Bringing MVP services up..."

& "$PSScriptRoot\\aws_resume_mvp.ps1" -Region $Region -ApiDesiredCount $ApiDesiredCount -WorkerDesiredCount $WorkerDesiredCount

Write-Host ""
& "$PSScriptRoot\\aws_status_mvp.ps1" -Region $Region

