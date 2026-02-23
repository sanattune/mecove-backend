resource "aws_security_group" "rds" {
  name        = "${local.name}-rds"
  description = "Postgres access from ECS tasks"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "Postgres from API/Worker tasks"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.api_tasks.id, aws_security_group.worker_tasks.id]
  }

  egress {
    description = "All egress"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${local.name}-rds"
    Project = local.project
    Env     = local.env
  }
}

resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db"
  subnet_ids = module.vpc.private_subnets

  tags = {
    Name    = "${local.name}-db"
    Project = local.project
    Env     = local.env
  }
}

resource "aws_db_instance" "postgres" {
  identifier = "${local.name}-postgres"

  engine              = "postgres"
  engine_version      = "16"
  instance_class      = "db.t4g.micro"
  allocated_storage   = 20
  storage_type        = "gp3"
  storage_encrypted   = true
  publicly_accessible = false
  multi_az            = false

  db_name  = "mecove"
  username = "mecove"

  manage_master_user_password = true

  vpc_security_group_ids = [aws_security_group.rds.id]
  db_subnet_group_name   = aws_db_subnet_group.main.name

  skip_final_snapshot = true
  deletion_protection = false

  # Free tier restriction: keep backups disabled for MVP/free-tier accounts.
  # You can raise this later (e.g., 7) once the account is upgraded.
  backup_retention_period  = 0
  delete_automated_backups = true

  tags = {
    Name    = "${local.name}-postgres"
    Project = local.project
    Env     = local.env
  }
}

output "rds_endpoint" {
  value = aws_db_instance.postgres.address
}

output "rds_port" {
  value = aws_db_instance.postgres.port
}

output "rds_master_secret_arn" {
  value = aws_db_instance.postgres.master_user_secret[0].secret_arn
}
