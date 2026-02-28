resource "aws_security_group" "ec2" {
  name        = "${local.name}-ec2"
  description = "EC2 instance: HTTP/HTTPS from internet (no public SSH)"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "All egress"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${local.name}-ec2"
    Project = local.project
    Env     = local.env
  }
}

resource "aws_security_group" "rds" {
  name        = "${local.name}-rds"
  description = "Postgres access from EC2 instance only"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "Postgres from EC2"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ec2.id]
  }

  tags = {
    Name    = "${local.name}-rds"
    Project = local.project
    Env     = local.env
  }
}
