resource "aws_ecr_repository" "app" {
  name                 = local.name
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}
