terraform {
  backend "s3" {
    bucket  = "mecove-tfstate-498735610795"
    key     = "mvp/terraform.tfstate"
    region  = "ap-south-1"
    encrypt = true
  }
}
