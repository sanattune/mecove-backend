param(
  [string]$Region = "ap-south-1",
  [string]$Cluster = "mecove-mvp",
  [string]$ApiService = "mecove-mvp-api",
  [string]$WorkerService = "mecove-mvp-worker",
  [string]$DbInstanceIdentifier = "mecove-mvp-postgres",
  [int]$ApiDesiredCount = 1,
  [int]$WorkerDesiredCount = 1
)

$ErrorActionPreference = "Stop"

function Exec([string]$cmd) {
  Write-Host ">> $cmd"
  Invoke-Expression $cmd
}

Write-Host "Resuming MVP resources in region '$Region'..."

Write-Host "Starting RDS instance..."
Exec "aws rds start-db-instance --region $Region --db-instance-identifier $DbInstanceIdentifier | Out-Null"

Write-Host "Waiting for RDS to become available (can take several minutes)..."
Exec "aws rds wait db-instance-available --region $Region --db-instance-identifier $DbInstanceIdentifier"

Write-Host "Scaling ECS services back up..."
Exec "aws ecs update-service --region $Region --cluster $Cluster --service $ApiService --desired-count $ApiDesiredCount | Out-Null"
Exec "aws ecs update-service --region $Region --cluster $Cluster --service $WorkerService --desired-count $WorkerDesiredCount | Out-Null"

Write-Host ""
Write-Host "Done."
Write-Host "Tip: verify health with: irm https://api.mecove.com/health"

