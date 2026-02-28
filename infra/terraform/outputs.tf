output "elastic_ip" {
  description = "Public IP for DNS A record"
  value       = aws_eip.main.public_ip
}

output "instance_id" {
  value = aws_instance.main.id
}

output "ssm_start_session_command" {
  description = "Start an SSM session to the instance (requires AWS CLI + SSM plugin)"
  value       = "aws ssm start-session --target ${aws_instance.main.id}"
}

output "ssm_deploy_command" {
  description = "Run deploy.sh via SSM without an interactive session"
  value       = "aws ssm send-command --document-name AWS-RunShellScript --targets Key=instanceIds,Values=${aws_instance.main.id} --parameters commands='sudo -u mecove /home/mecove/deploy.sh' --comment 'mecove deploy'"
}
