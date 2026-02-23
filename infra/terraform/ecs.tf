resource "aws_ecs_cluster" "main" {
  name = local.name
}

resource "aws_iam_role" "ecs_task_execution" {
  name = "${local.name}-ecs-exec"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "ecs-tasks.amazonaws.com" }
        Action    = "sts:AssumeRole"
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_managed" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_exec_secrets" {
  name = "${local.name}-ecs-exec-secrets"
  role = aws_iam_role.ecs_task_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["secretsmanager:GetSecretValue"]
        Resource = [
          aws_db_instance.postgres.master_user_secret[0].secret_arn,
          var.app_secrets_arn,
        ]
      },
    ]
  })
}

resource "aws_iam_role" "ecs_task" {
  name = "${local.name}-ecs-task"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "ecs-tasks.amazonaws.com" }
        Action    = "sts:AssumeRole"
      },
    ]
  })
}

locals {
  api_container_name    = "api"
  worker_container_name = "worker"
  image                 = "${aws_ecr_repository.app.repository_url}:latest"
  redis_url             = "redis://${aws_elasticache_cluster.redis.cache_nodes[0].address}:${aws_elasticache_cluster.redis.cache_nodes[0].port}"
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 1024
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = local.api_container_name
      image     = local.image
      essential = true
      portMappings = [
        { containerPort = 3000, hostPort = 3000, protocol = "tcp" },
      ]
      command = ["node", "dist/api/server.js"]
      environment = [
        { name = "REDIS_URL", value = local.redis_url },
        { name = "DB_HOST", value = aws_db_instance.postgres.address },
        { name = "DB_PORT", value = tostring(aws_db_instance.postgres.port) },
        { name = "DB_NAME", value = aws_db_instance.postgres.db_name },
        { name = "DB_SSLMODE", value = "require" },
        { name = "DB_USELIBPQCOMPAT", value = "true" },
        { name = "CONSENT_CONFIG_PATH", value = "consent.config.yaml" },
      ]
      secrets = [
        { name = "DB_USER", valueFrom = "${aws_db_instance.postgres.master_user_secret[0].secret_arn}:username::" },
        { name = "DB_PASSWORD", valueFrom = "${aws_db_instance.postgres.master_user_secret[0].secret_arn}:password::" },
        { name = "WHATSAPP_VERIFY_TOKEN", valueFrom = "${var.app_secrets_arn}:WHATSAPP_VERIFY_TOKEN::" },
        { name = "WHATSAPP_PHONE_NUMBER_ID", valueFrom = "${var.app_secrets_arn}:WHATSAPP_PHONE_NUMBER_ID::" },
        { name = "WHATSAPP_PERMANENT_TOKEN", valueFrom = "${var.app_secrets_arn}:WHATSAPP_PERMANENT_TOKEN::" },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = "ap-south-1"
          awslogs-stream-prefix = "ecs"
        }
      }
    },
  ])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 2048
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = local.worker_container_name
      image     = local.image
      essential = true
      command   = ["node", "dist/worker/worker.js"]
      environment = [
        { name = "REDIS_URL", value = local.redis_url },
        { name = "DB_HOST", value = aws_db_instance.postgres.address },
        { name = "DB_PORT", value = tostring(aws_db_instance.postgres.port) },
        { name = "DB_NAME", value = aws_db_instance.postgres.db_name },
        { name = "DB_SSLMODE", value = "require" },
        { name = "DB_USELIBPQCOMPAT", value = "true" },
      ]
      secrets = [
        { name = "DB_USER", valueFrom = "${aws_db_instance.postgres.master_user_secret[0].secret_arn}:username::" },
        { name = "DB_PASSWORD", valueFrom = "${aws_db_instance.postgres.master_user_secret[0].secret_arn}:password::" },
        { name = "WHATSAPP_PHONE_NUMBER_ID", valueFrom = "${var.app_secrets_arn}:WHATSAPP_PHONE_NUMBER_ID::" },
        { name = "WHATSAPP_PERMANENT_TOKEN", valueFrom = "${var.app_secrets_arn}:WHATSAPP_PERMANENT_TOKEN::" },
        { name = "OPENAI_API_KEY", valueFrom = "${var.app_secrets_arn}:OPENAI_API_KEY::" },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.worker.name
          awslogs-region        = "ap-south-1"
          awslogs-stream-prefix = "ecs"
        }
      }
    },
  ])
}

resource "aws_ecs_service" "api" {
  name            = "${local.name}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.public_subnets
    assign_public_ip = true
    security_groups  = [aws_security_group.api_tasks.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = local.api_container_name
    container_port   = 3000
  }

  depends_on = [aws_lb_listener.https]
}

resource "aws_ecs_service" "worker" {
  name            = "${local.name}-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = module.vpc.public_subnets
    assign_public_ip = true
    security_groups  = [aws_security_group.worker_tasks.id]
  }
}
