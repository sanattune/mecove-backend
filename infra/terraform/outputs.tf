output "vpc_id" {
  value = module.vpc.vpc_id
}

output "public_subnet_ids" {
  value = module.vpc.public_subnets
}

output "private_subnet_ids" {
  value = module.vpc.private_subnets
}

output "alb_dns_name" {
  value = aws_lb.api.dns_name
}

output "alb_zone_id" {
  value = aws_lb.api.zone_id
}

output "api_security_group_id" {
  value = aws_security_group.api_tasks.id
}

output "worker_security_group_id" {
  value = aws_security_group.worker_tasks.id
}

output "api_domain_name" {
  value = var.api_domain_name
}
