<#
.SYNOPSIS
Connect to the meCove MVP EC2 instance via AWS SSM Session Manager.

.DESCRIPTION
Finds the newest running EC2 instance matching the default Terraform tags (Project=mecove, Env=mvp)
and optionally a Name tag, then runs: aws ssm start-session --target <instance-id>.

Requires:
  - AWS CLI configured (aws configure / SSO)
  - Session Manager Plugin available for your AWS CLI environment

.EXAMPLE
./aws/connect-ec2.ps1

.EXAMPLE
./aws/connect-ec2.ps1 -Profile myprofile -Region ap-south-1

.EXAMPLE
./aws/connect-ec2.ps1 -NameTag mecove-mvp -PrintOnly
#>

[CmdletBinding()]
param(
  [string] $Region = "ap-south-1",
  [string] $Profile = "",
  [string] $ProjectTag = "mecove",
  [string] $EnvTag = "mvp",
  [string] $NameTag = "mecove-mvp",
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

  $query = "sort_by(Reservations[].Instances[], &LaunchTime)[-1].{InstanceId:InstanceId,LaunchTime:LaunchTime,InstanceType:InstanceType,PrivateIp:PrivateIpAddress,PublicIp:PublicIpAddress,Name:Tags[?Key=='Name']|[0].Value}"

  $json = & aws @awsArgs ec2 describe-instances --filters $filters --query $query --output json
  if (-not $json) { throw "No output from aws ec2 describe-instances." }

  $instance = $json | ConvertFrom-Json
  if (-not $instance -or -not $instance.InstanceId) {
    throw "No running instance found for Project=$ProjectTag Env=$EnvTag Name=$NameTag in $Region."
  }

  Write-Host ("Connecting via SSM..." )
  Write-Host ("  Name:         {0}" -f (Get-Coalesce $instance.Name "<none>"))
  Write-Host ("  InstanceId:   {0}" -f $instance.InstanceId)
  Write-Host ("  InstanceType: {0}" -f $instance.InstanceType)
  Write-Host ("  LaunchTime:   {0}" -f $instance.LaunchTime)
  Write-Host ("  PrivateIp:    {0}" -f (Get-Coalesce $instance.PrivateIp "<none>"))
  Write-Host ("  PublicIp:     {0}" -f (Get-Coalesce $instance.PublicIp "<none>"))

  $cmd = @("aws") + $awsArgs + @("ssm", "start-session", "--target", $instance.InstanceId)

  if ($PrintOnly) {
    Write-Host (Join-AwsArgs $cmd)
    exit 0
  }

  & aws @awsArgs ssm start-session --target $instance.InstanceId
} catch {
  Write-Error $_
  exit 1
}
