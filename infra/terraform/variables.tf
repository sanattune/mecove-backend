variable "api_domain_name" {
  description = "Public DNS name for the API (Caddy will obtain a Let's Encrypt cert for this)."
  type        = string
  default     = "api.mecove.com"
}

variable "app_secrets_arn" {
  description = "Secrets Manager ARN containing app runtime secrets (WhatsApp + LLM keys)."
  type        = string
  default     = "arn:aws:secretsmanager:ap-south-1:498735610795:secret:mecove-mvp/app-secrets-XMe5kC"
}

variable "github_deploy_key_secret_arn" {
  description = "Secrets Manager ARN containing the GitHub deploy key (SSH private key) for cloning the private repo."
  type        = string
}

variable "github_repo" {
  description = "GitHub repo in SSH format (git@github.com:org/repo.git)."
  type        = string
  default     = "git@github.com:sanattune/mecove-backend.git"
}

variable "github_branch" {
  description = "Git branch to deploy."
  type        = string
  default     = "main"
}

variable "instance_type" {
  description = "EC2 instance type."
  type        = string
  default     = "t4g.small"
}

variable "rds_backup_retention_period" {
  description = "RDS automated backup retention in days. Some Free Tier accounts are restricted to 0."
  type        = number
  default     = 0
}
