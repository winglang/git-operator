#!/bin/sh
set -euo pipefail
root=$(cd $(dirname $0) && pwd)

namespace="git-operator"

env="prod"
if [ "$(cat /etc/hosts | grep kind-control-plane | cut -d" " -f1)" == "127.0.0.1" ]; then
  env="dev"
fi

# if [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ]; then
#   aws_secret_name="aws-credentials"
#   kubectl delete secret $aws_secret_name -n $namespace 2>/dev/null || true
#   kubectl create secret generic $aws_secret_name -n $namespace --from-literal=AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID --from-literal=AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY
# fi

if [ -n "${GITHUB_TOKEN:-}" ]; then
  github_secret_name="github-token"
  kubectl delete secret $github_secret_name -n $namespace 2>/dev/null || true
  kubectl create secret generic $github_secret_name -n $namespace --from-literal=GITHUB_TOKEN=$GITHUB_TOKEN
fi

# # tf backend env var looks like this: "AWS_DEFAULT_REGION=us-east-1\nTF_BACKEND_BUCKET=eladcon-tfstate\n..."
# if [ -n "${TF_BACKEND_CONFIG:-}" ]; then
#   # write the env var to a temp fle
#   TEMP_TF_CONFIG=$(mktemp)
#   echo "$TF_BACKEND_CONFIG" > "$TEMP_TF_CONFIG"

#   tf_backend_cm="tf-backend-config"
#   kubectl delete configmap $tf_backend_cm -n $namespace 2>/dev/null || true
#   kubectl create configmap $tf_backend_cm -n $namespace --from-env-file=$TEMP_TF_CONFIG
# fi

if [ -n "${SLACK_API_TOKEN:-}" ]; then
  slack_secret_name="slack-token"
  kubectl delete secret $slack_secret_name -n $namespace 2>/dev/null || true
  kubectl create secret generic $slack_secret_name -n $namespace --from-literal=SLACK_API_TOKEN=$SLACK_API_TOKEN

  if [ $env == "dev" ]; then
    slack_channel="git-operator-dev-$USER"
  else
    # production
    slack_channel="git-operator-prod"
  fi

  slack_config="slack-config"
  kubectl delete configmap $slack_config -n $namespace 2>/dev/null || true
  kubectl create configmap $slack_config -n $namespace --from-literal=SLACK_CHANNEL=$slack_channel

  echo " 👾 Slack Channel: $slack_channel"
fi

if [ -n "${OPENAI_API_KEY:-}" ]; then
  openai_secret="openai-token"
  kubectl delete secret $openai_secret -n $namespace 2>/dev/null || true
  kubectl create secret generic $openai_secret -n $namespace --from-literal=OPENAI_API_KEY=$OPENAI_API_KEY
fi

npx projen deploy
