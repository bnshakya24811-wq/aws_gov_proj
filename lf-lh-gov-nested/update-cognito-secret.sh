#!/bin/bash
set -e

# Script to retrieve Cognito App Client Secret and store it in Secrets Manager
# Run this after deploying the Cognito stack

ENVIRONMENT=${1:-dev}
REGION=${2:-ap-southeast-2}

echo "🔍 Retrieving Cognito configuration..."

# Get User Pool ID and App Client ID from CloudFormation outputs
STACK_NAME="lf-lh-cognito-stack-o-sp6-${ENVIRONMENT}"
USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
  --output text \
  --region "${REGION}")

APP_CLIENT_ID=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --query 'Stacks[0].Outputs[?OutputKey==`AppClientId`].OutputValue' \
  --output text \
  --region "${REGION}")

echo "User Pool ID: ${USER_POOL_ID}"
echo "App Client ID: ${APP_CLIENT_ID}"

# Retrieve the App Client Secret from Cognito
echo "🔑 Retrieving App Client Secret from Cognito..."
CLIENT_SECRET=$(aws cognito-idp describe-user-pool-client \
  --user-pool-id "${USER_POOL_ID}" \
  --client-id "${APP_CLIENT_ID}" \
  --query 'UserPoolClient.ClientSecret' \
  --output text \
  --region "${REGION}")

if [ -z "${CLIENT_SECRET}" ]; then
  echo "❌ Error: Could not retrieve client secret"
  exit 1
fi

echo "✅ Client secret retrieved successfully"

# Update Secrets Manager with the actual secret
SECRET_NAME="lf-cognito-client-secret-${ENVIRONMENT}"
echo "💾 Updating secret in Secrets Manager: ${SECRET_NAME}"

SECRET_VALUE=$(cat <<EOF
{
  "client_id": "${APP_CLIENT_ID}",
  "client_secret": "${CLIENT_SECRET}",
  "user_pool_id": "${USER_POOL_ID}"
}
EOF
)

aws secretsmanager update-secret \
  --secret-id "${SECRET_NAME}" \
  --secret-string "${SECRET_VALUE}" \
  --region "${REGION}"

echo "✅ Secret updated successfully in Secrets Manager"
echo ""
echo "Secret details:"
echo "  Name: ${SECRET_NAME}"
echo "  User Pool ID: ${USER_POOL_ID}"
echo "  App Client ID: ${APP_CLIENT_ID}"
echo ""
echo "You can now deploy the Lambda stack with OAuth support enabled."
