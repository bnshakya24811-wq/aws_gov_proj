#!/bin/bash
set -e

# ============================================
# API Key Solution Deployment Script
# ============================================
# Deploys isolated API Key authentication for Lake Formation Athena queries
# Usage: ./deploy-apikey-solution.sh <environment> <s3-bucket>

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ENVIRONMENT=${1:-dev}
S3_BUCKET=${2:-deploymen-bkt}
REGION=${3:-us-east-1}

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}API Key Solution Deployment${NC}"
echo -e "${BLUE}================================================${NC}"
echo -e "Environment: ${GREEN}$ENVIRONMENT${NC}"
echo -e "S3 Bucket: ${GREEN}$S3_BUCKET${NC}"
echo -e "Region: ${GREEN}$REGION${NC}"
echo ""

# ============================================
# Step 1: Build Lambda
# ============================================
echo -e "${YELLOW}Step 1: Building Lambda function...${NC}"
cd lambdas-ts-apikey

if [ ! -f "package.json" ]; then
  echo -e "${RED}Error: package.json not found. Are you in the correct directory?${NC}"
  exit 1
fi

echo "  → Installing dependencies..."
npm install --silent

echo "  → Compiling TypeScript..."
npm run build

echo "  → Creating deployment package..."
cd dist
zip -r -q ../lambda.zip .
cd ..

LAMBDA_SIZE=$(du -h lambda.zip | cut -f1)
echo -e "${GREEN}✓ Lambda package created: $LAMBDA_SIZE${NC}"

# ============================================
# Step 2: Upload Lambda to S3
# ============================================
echo -e "${YELLOW}Step 2: Uploading Lambda package to S3...${NC}"
S3_KEY="lambda/athena-query-apikey-${ENVIRONMENT}.zip"

aws s3 cp lambda.zip "s3://${S3_BUCKET}/${S3_KEY}" --region $REGION

echo -e "${GREEN}✓ Uploaded to s3://${S3_BUCKET}/${S3_KEY}${NC}"
cd ..

# ============================================
# Step 3: Get Prerequisites
# ============================================
echo -e "${YELLOW}Step 3: Gathering prerequisite values...${NC}"

# Prompt for required values
read -p "Enter DynamoDB API Key Table Name [lf-api-key-mappings-${ENVIRONMENT}]: " API_KEY_TABLE
API_KEY_TABLE=${API_KEY_TABLE:-lf-api-key-mappings-${ENVIRONMENT}}

read -p "Enter Glue Database Name [lf-lh-silver-db-${ENVIRONMENT}]: " DATABASE_NAME
DATABASE_NAME=${DATABASE_NAME:-lf-lh-silver-db-${ENVIRONMENT}}

read -p "Enter LF Dev User Role ARN: " LF_DEV_ROLE_ARN
if [ -z "$LF_DEV_ROLE_ARN" ]; then
  echo -e "${RED}Error: Dev User Role ARN is required${NC}"
  exit 1
fi

read -p "Enter LF Super User Role ARN: " LF_SUPER_ROLE_ARN
if [ -z "$LF_SUPER_ROLE_ARN" ]; then
  echo -e "${RED}Error: Super User Role ARN is required${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Prerequisites gathered${NC}"

# ============================================
# Step 4: Deploy Lambda Stack
# ============================================
echo -e "${YELLOW}Step 4: Deploying Lambda stack...${NC}"

LAMBDA_STACK_NAME="lf-lambda-apikey-${ENVIRONMENT}"

aws cloudformation deploy \
  --stack-name "$LAMBDA_STACK_NAME" \
  --template-file lambda-apikey-stack.yaml \
  --parameter-overrides \
    Environment="$ENVIRONMENT" \
    LFDevUserArn="$LF_DEV_ROLE_ARN" \
    LFSuperUserArn="$LF_SUPER_ROLE_ARN" \
    APIKeyMappingTableName="$API_KEY_TABLE" \
    DatabaseName="$DATABASE_NAME" \
    LambdaCodeS3Bucket="$S3_BUCKET" \
    LambdaCodeS3Key="$S3_KEY" \
  --capabilities CAPABILITY_NAMED_IAM \
  --region $REGION \
  --no-fail-on-empty-changeset

echo -e "${GREEN}✓ Lambda stack deployed${NC}"

# Get Lambda ARN
LAMBDA_ARN=$(aws cloudformation describe-stacks \
  --stack-name "$LAMBDA_STACK_NAME" \
  --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`LambdaFunctionArn`].OutputValue' \
  --output text)

echo -e "Lambda ARN: ${BLUE}$LAMBDA_ARN${NC}"

# ============================================
# Step 5: Deploy API Stack
# ============================================
echo -e "${YELLOW}Step 5: Deploying API Gateway stack...${NC}"

API_STACK_NAME="lf-api-apikey-${ENVIRONMENT}"

aws cloudformation deploy \
  --stack-name "$API_STACK_NAME" \
  --template-file api-apikey-stack.yaml \
  --parameter-overrides \
    Environment="$ENVIRONMENT" \
    LambdaFunctionArn="$LAMBDA_ARN" \
  --region $REGION \
  --no-fail-on-empty-changeset

echo -e "${GREEN}✓ API Gateway stack deployed${NC}"

# ============================================
# Step 6: Get Outputs
# ============================================
echo -e "${YELLOW}Step 6: Retrieving deployment outputs...${NC}"

API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name "$API_STACK_NAME" \
  --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`QueryEndpoint`].OutputValue' \
  --output text)

API_KEY_ID=$(aws cloudformation describe-stacks \
  --stack-name "$API_STACK_NAME" \
  --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`DemoApiKeyId`].OutputValue' \
  --output text)

API_KEY_VALUE=$(aws apigateway get-api-key \
  --api-key "$API_KEY_ID" \
  --include-value \
  --region $REGION \
  --query 'value' \
  --output text)

# ============================================
# Summary
# ============================================
echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "${BLUE}API Endpoint:${NC}"
echo -e "  $API_ENDPOINT"
echo ""
echo -e "${BLUE}Demo API Key:${NC}"
echo -e "  $API_KEY_VALUE"
echo ""
echo -e "${BLUE}Test Command:${NC}"
cat << EOF
  curl -X POST "$API_ENDPOINT" \\
    -H "x-api-key: $API_KEY_VALUE" \\
    -H "Content-Type: application/json" \\
    -d '{
      "tableName": "YOUR_TABLE_NAME",
      "limit": 10
    }'
EOF
echo ""
echo -e "${YELLOW}Note: Make sure you have API key mappings in DynamoDB table: $API_KEY_TABLE${NC}"
echo ""
echo -e "${BLUE}CloudWatch Logs:${NC}"
echo -e "  /aws/lambda/lf-athena-apikey-handler-${ENVIRONMENT}"
echo ""

# ============================================
# Save outputs to file
# ============================================
OUTPUT_FILE="apikey-deployment-${ENVIRONMENT}.txt"
cat > "$OUTPUT_FILE" << EOF
API Key Solution Deployment - $ENVIRONMENT
========================================
Deployed: $(date)
Region: $REGION

Stack Names:
  Lambda: $LAMBDA_STACK_NAME
  API: $API_STACK_NAME

Resources:
  Lambda ARN: $LAMBDA_ARN
  API Endpoint: $API_ENDPOINT
  Demo API Key: $API_KEY_VALUE
  API Key ID: $API_KEY_ID

DynamoDB Table: $API_KEY_TABLE
Glue Database: $DATABASE_NAME

Test Command:
curl -X POST "$API_ENDPOINT" \\
  -H "x-api-key: $API_KEY_VALUE" \\
  -H "Content-Type: application/json" \\
  -d '{"tableName": "YOUR_TABLE", "limit": 10}'
EOF

echo -e "${GREEN}✓ Deployment details saved to: $OUTPUT_FILE${NC}"
echo ""
