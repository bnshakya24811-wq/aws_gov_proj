#!/bin/bash
# Deployment script for Lake Formation Access Control POC with API Gateway + Lambda + Athena

set -e

# Configuration
ENVIRONMENT=${1:-dev}
TEMPLATE_BUCKET=${2:-your-cloudformation-templates-bucket}
TEMPLATE_PREFIX="lf-nested-stacks"
LAMBDA_CODE_BUCKET=${TEMPLATE_BUCKET}
STACK_NAME="lf-lh-main-o-sp6-${ENVIRONMENT}"
REGION="us-east-1"

echo "========================================="
echo "Lake Formation API Deployment Script"
echo "========================================="
echo "Environment: ${ENVIRONMENT}"
echo "Template Bucket: ${TEMPLATE_BUCKET}"
echo "Region: ${REGION}"
echo "Stack Name: ${STACK_NAME}"
echo "========================================="

# Step 1: Create S3 bucket if it doesn't exist
echo "Step 1: Verifying S3 bucket exists..."
if ! aws s3 ls "s3://${TEMPLATE_BUCKET}" 2>&1 > /dev/null; then
    echo "Creating S3 bucket: ${TEMPLATE_BUCKET}"
    aws s3 mb "s3://${TEMPLATE_BUCKET}" --region ${REGION}
else
    echo "S3 bucket already exists: ${TEMPLATE_BUCKET}"
fi

# Step 2: Package Lambda function
echo ""
echo "Step 2: Packaging Lambda function..."
cd lambdas
if [ -f "athena-query-handler.zip" ]; then
    rm athena-query-handler.zip
fi
zip athena-query-handler.zip index.py
cd ..

# Step 3: Upload Lambda code to S3
echo ""
echo "Step 3: Uploading Lambda deployment package..."
aws s3 cp lambdas/athena-query-handler.zip \
    "s3://${LAMBDA_CODE_BUCKET}/lambda/athena-query-handler.zip"

# Step 4: Upload nested stack templates
echo ""
echo "Step 4: Uploading CloudFormation templates..."
aws s3 cp iam-stack.yaml \
    "s3://${TEMPLATE_BUCKET}/${TEMPLATE_PREFIX}/iam-stack.yaml"
aws s3 cp glue-stack.yaml \
    "s3://${TEMPLATE_BUCKET}/${TEMPLATE_PREFIX}/glue-stack.yaml"
aws s3 cp governance-stack.yaml \
    "s3://${TEMPLATE_BUCKET}/${TEMPLATE_PREFIX}/governance-stack.yaml"
aws s3 cp lambda-stack.yaml \
    "s3://${TEMPLATE_BUCKET}/${TEMPLATE_PREFIX}/lambda-stack.yaml"
aws s3 cp api-stack.yaml \
    "s3://${TEMPLATE_BUCKET}/${TEMPLATE_PREFIX}/api-stack.yaml"
aws s3 cp dynamodb-stack.yaml \
    "s3://${TEMPLATE_BUCKET}/${TEMPLATE_PREFIX}/dynamodb-stack.yaml"

# Step 5: Deploy main stack
echo ""
echo "Step 5: Deploying CloudFormation stack..."
aws cloudformation deploy \
    --template-file main.yaml \
    --stack-name ${STACK_NAME} \
    --parameter-overrides \
        TemplateS3Bucket=${TEMPLATE_BUCKET} \
        TemplateS3Prefix=${TEMPLATE_PREFIX} \
        LambdaCodeS3Bucket=${LAMBDA_CODE_BUCKET} \
        Environment=${ENVIRONMENT} \
    --capabilities CAPABILITY_NAMED_IAM \
    --region ${REGION}

# Step 6: Get stack outputs
echo ""
echo "========================================="
echo "Deployment Complete!"
echo "========================================="
echo ""
echo "Retrieving stack outputs..."
aws cloudformation describe-stacks \
    --stack-name ${STACK_NAME} \
    --region ${REGION} \
    --query 'Stacks[0].Outputs[?OutputKey==`APIEndpoint` || OutputKey==`DevUserAPIKey` || OutputKey==`SuperUserAPIKey`]' \
    --output table

echo ""
echo "========================================="
echo "Next Steps:"
echo "========================================="
echo "1. Run the Glue crawler to populate tables:"
echo "   aws glue start-crawler --name lf-lh-silver-crawler-o-sp5-${ENVIRONMENT}"
echo ""
echo "2. Tag columns as PII after crawler completes:"
echo "   python ../tag_column_as_pii.py --db <db-name> --table <table-name> --column <column-name>"
echo ""
echo "3. Test the API with curl:"
echo "   API_ENDPOINT=\$(aws cloudformation describe-stacks --stack-name ${STACK_NAME} --query 'Stacks[0].Outputs[?OutputKey==\`APIEndpoint\`].OutputValue' --output text)"
echo "   DEV_API_KEY=\$(aws cloudformation describe-stacks --stack-name ${STACK_NAME} --query 'Stacks[0].Outputs[?OutputKey==\`DevUserAPIKey\`].OutputValue' --output text)"
echo ""
echo "   curl -X POST \${API_ENDPOINT} \\"
echo "     -H \"x-api-key: \${DEV_API_KEY}\" \\"
echo "     -H \"Content-Type: application/json\" \\"
echo "     -d '{\"tableName\": \"members\", \"limit\": 10}'"
echo ""
echo "========================================="
