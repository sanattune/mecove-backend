resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "ALB ingress (80/443) from internet"
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
    Name    = "${local.name}-alb"
    Project = local.project
    Env     = local.env
  }
}

resource "aws_security_group" "api_tasks" {
  name        = "${local.name}-api"
  description = "API ECS tasks"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "From ALB to API container"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "All egress (tighten later)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${local.name}-api"
    Project = local.project
    Env     = local.env
  }
}

resource "aws_security_group" "worker_tasks" {
  name        = "${local.name}-worker"
  description = "Worker ECS tasks"
  vpc_id      = module.vpc.vpc_id

  egress {
    description = "All egress (tighten later)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name    = "${local.name}-worker"
    Project = local.project
    Env     = local.env
  }
}

