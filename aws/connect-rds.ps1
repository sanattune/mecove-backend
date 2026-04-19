<#
.SYNOPSIS
Start an AWS SSM port-forwarding session from the local machine to the meCove MVP RDS instance.

.DESCRIPTION
Finds the newest running EC2 instance matching the default Terraform tags, resolves the RDS endpoint,
then starts an SSM tunnel from a local port to the remote Postgres host and port.

Requires:
  - AWS CLI configured (aws configure / SSO)
  - Session Manager Plugin available for your AWS CLI environment

.EXAMPLE
./aws/connect-rds.ps1

.EXAMPLE
./aws/connect-rds.ps1 -Profile myprofile -Region ap-south-1 -LocalPort 15432
#>

[CmdletBinding()]
param(
  [string] $Region = "ap-south-1",
  [string] $Profile = "",
  [string] $ProjectTag = "mecove",
  [string] $EnvTag = "mvp",
  [string] $NameTag = "mecove-mvp",
  [string] $DbInstanceIdentifier = "mecove-mvp-postgres",
  [int] $LocalPort = 15432,
  [switch] $PrintOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-Coalesce([object] $value, [string] $fallback) {
  if ($null -eq $value) { return $fallback }
  $s = $value -as [string]
  if ([string]::IsNullOrWhiteSpace($s)) { return $fallback }
  return $s
}

function Join-AwsArgs([string[]] $args) {
  ($args | ForEach-Object {
    if ($_ -match '\s') { '"' + ($_ -replace '"','\"') + '"' } else { $_ }
  }) -join ' '
}

try {
  $awsArgs = @()
  if ($Profile) { $awsArgs += @("--profile", $Profile) }
  $awsArgs += @("--region", $Region)

  $filters = @(
    "Name=instance-state-name,Values=running",
    "Name=tag:Project,Values=$ProjectTag",
    "Name=tag:Env,Values=$EnvTag"
  )
  if ($NameTag) {
    $filters += "Name=tag:Name,Values=$NameTag"
  }

  $instanceQuery = "sort_by(Reservations[].Instances[], &LaunchTime)[-1].{InstanceId:InstanceId,LaunchTime:LaunchTime,InstanceType:InstanceType,PrivateIp:PrivateIpAddress,PublicIp:PublicIpAddress,Name:Tags[?Key=='Name']|[0].Value}"
  $instanceJson = & aws @awsArgs ec2 describe-instances --filters $filters --query $instanceQuery --output json
  if (-not $instanceJson) { throw "No output from aws ec2 describe-instances." }

  $instance = $instanceJson | ConvertFrom-Json
  if (-not $instance -or -not $instance.InstanceId) {
    throw "No running instance found for Project=$ProjectTag Env=$EnvTag Name=$NameTag in $Region."
  }

  $dbQuery = "DBInstances[0].{Endpoint:Endpoint.Address,Port:Endpoint.Port,DBName:DBName,Status:DBInstanceStatus,PubliclyAccessible:PubliclyAccessible,MasterUsername:MasterUsername}"
  $dbJson = & aws @awsArgs rds describe-db-instances --db-instance-identifier $DbInstanceIdentifier --query $dbQuery --output json
  if (-not $dbJson) { throw "No output from aws rds describe-db-instances." }

  $db = $dbJson | ConvertFrom-Json
  if (-not $db -or -not $db.Endpoint) {
    throw "RDS instance $DbInstanceIdentifier was not found in $Region."
  }

  $parameters = "host=$($db.Endpoint),portNumber=$($db.Port),localPortNumber=$LocalPort"
  $cmd = @("aws") + $awsArgs + @(
    "ssm", "start-session",
    "--target", $instance.InstanceId,
    "--document-name", "AWS-StartPortForwardingSessionToRemoteHost",
    "--parameters", $parameters
  )

  Write-Host ("Starting RDS tunnel via SSM...")
  Write-Host ("  Instance:      {0}" -f $instance.InstanceId)
  Write-Host ("  Instance Name: {0}" -f (Get-Coalesce $instance.Name "<none>"))
  Write-Host ("  RDS Endpoint:  {0}" -f $db.Endpoint)
  Write-Host ("  Remote Port:   {0}" -f $db.Port)
  Write-Host ("  Local Port:    {0}" -f $LocalPort)
  Write-Host ("  Database:      {0}" -f (Get-Coalesce $db.DBName "<none>"))
  Write-Host ("  Username:      {0}" -f (Get-Coalesce $db.MasterUsername "<none>"))
  Write-Host ("")
  Write-Host ("Connect your SQL client to 127.0.0.1:{0} while this session is open." -f $LocalPort)

  if ($PrintOnly) {
    Write-Host ""
    Write-Host (Join-AwsArgs $cmd)
    exit 0
  }

  & aws @awsArgs ssm start-session `
    --target $instance.InstanceId `
    --document-name AWS-StartPortForwardingSessionToRemoteHost `
    --parameters $parameters
} catch {
  Write-Error $_
  exit 1
}
