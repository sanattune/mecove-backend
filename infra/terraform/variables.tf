variable "acm_certificate_arn" {
  description = "ACM certificate ARN in the same region as the ALB (ap-south-1)."
  type        = string
  default     = "arn:aws:acm:ap-south-1:498735610795:certificate/08ea4708-902f-4404-b7c4-a2c69beca41e"
}

variable "api_domain_name" {
  description = "Public DNS name for the API (used for outputs/instructions)."
  type        = string
  default     = "api.mecove.com"
}

variable "app_secrets_arn" {
  description = "Secrets Manager ARN containing app runtime secrets (WhatsApp + LLM keys)."
  type        = string
  default     = "arn:aws:secretsmanager:ap-south-1:498735610795:secret:mecove-mvp/app-secrets-XMe5kC"
}
