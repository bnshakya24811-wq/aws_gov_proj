#!/bin/bash
# Deploy OAuth Client Credentials Stack

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "🚀 Deploying OAuth Client Credentials Stack"
echo "==========================================="

# Parameters
ENVIRONMENT=${1:-dev}
TEMPLATES_BUCKET=${2:-deploymen-bkt}
TEMPLATES_REGION=${3:-ap-southeast-2}

# Get existing IAM stack outputs (assuming it's already deployed)
IAM_STACK_NAME="lf-lh-iam-stack-o-sp6-${ENVIRONMENT}"

echo "📋 Getting IAM stack outputs..."
LF_DEV_ROLE_ARN=$(aws cloudformation describe-stacks \
  --stack-name $IAM_STACK_NAME \
  --query 'Stacks[0].Outputs[?OutputKey==`LFDevUserRoleArn`].OutputValue' \
  --output text 2>/dev/null || echo "")

LF_SUPER_ROLE_ARN=$(aws cloudformation describe-stacks \
  --stack-name $IAM_STACK_NAME \
  --query 'Stacks[0].Outputs[?OutputKey==`LFSuperUserRoleArn`].OutputValue' \
  --output text 2>/dev/null || echo "")

# Get database name from Glue stack
GLUE_STACK_NAME="lf-lh-glue-stack-o-sp6-${ENVIRONMENT}"
DATABASE_NAME=$(aws cloudformation describe-stacks \
  --stack-name $GLUE_STACK_NAME \
  --query 'Stacks[0].Outputs[?OutputKey==`DatabaseName`].OutputValue' \
  --output text 2>/dev/null || echo "lf-lh-silver-db-o-sp6-${ENVIRONMENT}")

if [ -z "$LF_DEV_ROLE_ARN" ] || [ -z "$LF_SUPER_ROLE_ARN" ]; then
  echo -e "${RED}❌ Could not find IAM stack outputs. Deploy IAM stack first.${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Found IAM roles:${NC}"
echo "  Dev Role: $LF_DEV_ROLE_ARN"
echo "  Super Role: $LF_SUPER_ROLE_ARN"
echo "  Database: $DATABASE_NAME"
echo ""

# Step 1: Package Lambda function
echo "📦 Packaging Lambda function..."
cd lambda
zip -r ../oauth-client-creds-handler.zip index.py
cd ..

# Step 2: Upload Lambda to S3
echo "☁️  Uploading Lambda to S3..."
aws s3 cp oauth-client-creds-handler.zip s3://${TEMPLATES_BUCKET}/lambda/ \
  --region ${TEMPLATES_REGION}

# Step 3: Upload nested stack templates
echo "☁️  Uploading nested templates to S3..."
aws s3 cp cognito-client-creds-stack.yaml s3://${TEMPLATES_BUCKET}/nested/ --region ${TEMPLATES_REGION}
aws s3 cp lambda-client-creds-stack.yaml s3://${TEMPLATES_BUCKET}/nested/ --region ${TEMPLATES_REGION}
aws s3 cp api-client-creds-stack.yaml s3://${TEMPLATES_BUCKET}/nested/ --region ${TEMPLATES_REGION}

# Step 4: Deploy main stack
echo "🚀 Deploying CloudFormation stack..."
STACK_NAME="lf-client-creds-main-${ENVIRONMENT}"

aws cloudformation deploy \
  --template-file main-client-creds.yaml \
  --stack-name ${STACK_NAME} \
  --parameter-overrides \
    Environment=${ENVIRONMENT} \
    TemplatesBucket=${TEMPLATES_BUCKET} \
    TemplatesBucketRegion=${TEMPLATES_REGION} \
    LambdaCodeBucket=${TEMPLATES_BUCKET} \
    LFDevRoleArn=${LF_DEV_ROLE_ARN} \
    LFSuperRoleArn=${LF_SUPER_ROLE_ARN} \
    DatabaseName=${DATABASE_NAME} \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1

echo ""
echo -e "${GREEN}✅ Stack deployed successfully!${NC}"
echo ""

# Step 5: Get outputs
echo "📋 Stack Outputs:"
echo "================"

API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --query 'Stacks[0].Outputs[?OutputKey==`APIEndpoint`].OutputValue' \
  --output text)

TOKEN_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --query 'Stacks[0].Outputs[?contains(OutputKey, `TokenEndpoint`)].OutputValue' \
  --output text)

ETL_CLIENT_ID=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --query 'Stacks[0].Outputs[?OutputKey==`ETLClientId`].OutputValue' \
  --output text)

REPORTING_CLIENT_ID=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --query 'Stacks[0].Outputs[?OutputKey==`ReportingClientId`].OutputValue' \
  --output text)

echo "API Endpoint: $API_ENDPOINT"
echo "Token Endpoint: $TOKEN_ENDPOINT"
echo "ETL Client ID: $ETL_CLIENT_ID"
echo "Reporting Client ID: $REPORTING_CLIENT_ID"
echo ""

# Step 6: Instructions for client secrets
echo -e "${YELLOW}⚠️  IMPORTANT: Update Client Secrets${NC}"
echo "========================================="
echo "You need to manually update the client secrets in Secrets Manager:"
echo ""
echo "1. Get ETL client secret:"
echo "   aws cognito-idp describe-user-pool-client \\"
echo "     --user-pool-id <USER_POOL_ID> \\"
echo "     --client-id $ETL_CLIENT_ID \\"
echo "     --query 'UserPoolClient.ClientSecret' --output text"
echo ""
echo "2. Update secret in Secrets Manager:"
echo "   aws secretsmanager update-secret \\"
echo "     --secret-id lf-etl-client-secret-${ENVIRONMENT} \\"
echo "     --secret-string '{\"client_id\":\"$ETL_CLIENT_ID\",\"client_secret\":\"<SECRET>\"}'"
echo ""
echo "Repeat for reporting-service-client and monitoring-service-client"
echo ""

echo -e "${GREEN}🎉 Deployment complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Update client secrets (see above)"
echo "2. Test with: ./test-client-creds.sh"
