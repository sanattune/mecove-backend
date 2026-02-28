resource "aws_cloudwatch_log_group" "api" {
  name              = "/ec2/${local.name}/api"
  retention_in_days = 3
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ec2/${local.name}/worker"
  retention_in_days = 3
}

resource "aws_cloudwatch_log_group" "caddy" {
  name              = "/ec2/${local.name}/caddy"
  retention_in_days = 3
}
