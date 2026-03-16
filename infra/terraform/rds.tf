resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db"
  subnet_ids = module.vpc.public_subnets

  tags = {
    Name    = "${local.name}-db"
    Project = local.project
    Env     = local.env
  }
}

# Alphanumeric-only password avoids URL-encoding issues in connection strings.
resource "random_password" "db_master" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "db_master" {
  name                    = "${local.name}/db-master"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "db_master" {
  secret_id = aws_secretsmanager_secret.db_master.id
  secret_string = jsonencode({
    username = "mecove"
    password = random_password.db_master.result
  })
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
  password = random_password.db_master.result

  vpc_security_group_ids = [aws_security_group.rds.id]
  db_subnet_group_name   = aws_db_subnet_group.main.name

  skip_final_snapshot = true
  deletion_protection = false

  backup_retention_period  = var.rds_backup_retention_period
  delete_automated_backups = var.rds_backup_retention_period == 0

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
  value = aws_secretsmanager_secret.db_master.arn
}
