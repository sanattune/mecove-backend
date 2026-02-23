param(
  [string]$Region = "ap-south-1",
  [string]$Cluster = "mecove-mvp",
  [string]$ApiService = "mecove-mvp-api",
  [string]$WorkerService = "mecove-mvp-worker",
  [string]$DbInstanceIdentifier = "mecove-mvp-postgres",
  [string]$RedisClusterId = "mecove-mvp-redis",
  [string]$AlbName = "mecove-mvp-alb"
)

$ErrorActionPreference = "Stop"

Write-Host "Region: $Region"
Write-Host ""

Write-Host "ECS services:"
try {
  aws ecs describe-services --region $Region --cluster $Cluster --services $ApiService $WorkerService `
    --query "services[].{name:serviceName,desired:desiredCount,running:runningCount,pending:pendingCount,taskDef:taskDefinition}" `
    --output table
} catch {
  Write-Host "(ECS services not found or not accessible)"
}

Write-Host ""
Write-Host "RDS:"
try {
  aws rds describe-db-instances --region $Region --db-instance-identifier $DbInstanceIdentifier `
    --query "DBInstances[0].{id:DBInstanceIdentifier,status:DBInstanceStatus,endpoint:Endpoint.Address,port:Endpoint.Port}" `
    --output table
} catch {
  Write-Host "(RDS instance not found or not accessible)"
}

Write-Host ""
Write-Host "ElastiCache Redis:"
try {
  aws elasticache describe-cache-clusters --region $Region --cache-cluster-id $RedisClusterId --show-cache-node-info `
    --query "CacheClusters[0].{id:CacheClusterId,status:CacheClusterStatus,endpoint:CacheNodes[0].Endpoint.Address,port:CacheNodes[0].Endpoint.Port}" `
    --output table
} catch {
  Write-Host "(Redis cluster not found or not accessible)"
}

Write-Host ""
Write-Host "ALB:"
try {
  aws elbv2 describe-load-balancers --region $Region --names $AlbName `
    --query "LoadBalancers[0].{name:LoadBalancerName,state:State.Code,dns:DNSName}" `
    --output table
} catch {
  Write-Host "(ALB not found or not accessible)"
}

