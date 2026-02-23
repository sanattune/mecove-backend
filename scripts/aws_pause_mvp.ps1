param(
  [string]$Region = "ap-south-1",
  [string]$Cluster = "mecove-mvp",
  [string]$ApiService = "mecove-mvp-api",
  [string]$WorkerService = "mecove-mvp-worker",
  [string]$DbInstanceIdentifier = "mecove-mvp-postgres"
)

$ErrorActionPreference = "Stop"

function Exec([string]$cmd) {
  Write-Host ">> $cmd"
  Invoke-Expression $cmd
}

Write-Host "Pausing MVP resources in region '$Region'..."

Write-Host "Scaling ECS services to 0 (stops Fargate compute charges)..."
Exec "aws ecs update-service --region $Region --cluster $Cluster --service $ApiService --desired-count 0 | Out-Null"
Exec "aws ecs update-service --region $Region --cluster $Cluster --service $WorkerService --desired-count 0 | Out-Null"

Write-Host "Stopping RDS instance (stops DB compute charges; storage still billed)..."
Exec "aws rds stop-db-instance --region $Region --db-instance-identifier $DbInstanceIdentifier | Out-Null"

Write-Host ""
Write-Host "Done."
Write-Host "Remaining costs (if still provisioned): ALB + ElastiCache Redis + RDS storage + CloudWatch logs + Secrets + S3 state."
Write-Host "To check status, run: .\scripts\aws_status_mvp.ps1"

