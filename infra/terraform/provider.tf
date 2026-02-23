provider "aws" {
  region = "ap-south-1"
}

locals {
  project = "mecove"
  env     = "mvp"
  name    = "${local.project}-${local.env}"
}
