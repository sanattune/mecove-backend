#!/usr/bin/env bash
set -euo pipefail

# Connect to the meCove MVP EC2 instance via AWS SSM Session Manager.
#
# Requires:
#   - aws cli configured
#   - session-manager-plugin installed
#
# Usage:
#   ./aws/connect-ec2.sh
#   AWS_PROFILE=... AWS_REGION=ap-south-1 ./aws/connect-ec2.sh

AWS_REGION="${AWS_REGION:-ap-south-1}"
PROJECT_TAG="${PROJECT_TAG:-mecove}"
ENV_TAG="${ENV_TAG:-mvp}"
NAME_TAG="${NAME_TAG:-mecove-mvp}"

filters=(
  "Name=instance-state-name,Values=running"
  "Name=tag:Project,Values=${PROJECT_TAG}"
  "Name=tag:Env,Values=${ENV_TAG}"
)
if [ -n "${NAME_TAG}" ]; then
  filters+=("Name=tag:Name,Values=${NAME_TAG}")
fi

instance_id="$(
  aws --region "$AWS_REGION" ec2 describe-instances \
    --filters "${filters[@]}" \
    --query "sort_by(Reservations[].Instances[], &LaunchTime)[-1].InstanceId" \
    --output text
)"

if [ -z "$instance_id" ] || [ "$instance_id" = "None" ]; then
  echo "No running instance found for Project=${PROJECT_TAG} Env=${ENV_TAG} Name=${NAME_TAG} in ${AWS_REGION}" >&2
  exit 1
fi

exec aws --region "$AWS_REGION" ssm start-session --target "$instance_id"

