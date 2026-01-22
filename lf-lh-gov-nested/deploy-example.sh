#!/bin/bash

# Multi-environment deployment script for Lake Formation nested stacks

set -e

# Configuration
TEMPLATE_BUCKET="your-cloudformation-templates-bucket"
TEMPLATE_PREFIX="lf-nested-stacks"
REGION="${AWS_REGION:-us-east-1}"
ENVIRONMENT="${1:-dev}"

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
  echo "Error: Environment must be dev, staging, or prod"
  echo "Usage: $0 <environment>"
  exit 1
fi

STACK_NAME="lf-lh-master-stack-o-sp5-${ENVIRONMENT}"

echo "========================================="
echo "Lake Formation Multi-Environment Deploy"
echo "========================================="
echo "Environment: $ENVIRONMENT"
echo "Stack Name: $STACK_NAME"
echo "Region: $REGION"
echo "========================================="

# Step 1: Upload nested templates to S3
echo ""
echo "Step 1: Uploading nested stack templates to S3..."
aws s3 cp iam-stack.yaml s3://${TEMPLATE_BUCKET}/${TEMPLATE_PREFIX}/ --region $REGION
aws s3 cp glue-stack.yaml s3://${TEMPLATE_BUCKET}/${TEMPLATE_PREFIX}/ --region $REGION
aws s3 cp governance-stack.yaml s3://${TEMPLATE_BUCKET}/${TEMPLATE_PREFIX}/ --region $REGION
echo "✅ Templates uploaded"

# Step 2: Deploy master stack
echo ""
echo "Step 2: Deploying master stack for environment: $ENVIRONMENT"
aws cloudformation deploy \
  --stack-name $STACK_NAME \
  --template-file main.yaml \
  --parameter-overrides \
    TemplateS3Bucket=$TEMPLATE_BUCKET \
    TemplateS3Prefix=$TEMPLATE_PREFIX \
    Environment=$ENVIRONMENT \
  --capabilities CAPABILITY_NAMED_IAM \
  --region $REGION \
  --tags \
    Environment=$ENVIRONMENT \
    Project=LakeFormationAccessControl \
    ManagedBy=CloudFormation

# Step 3: Get stack outputs
echo ""
echo "Step 3: Retrieving stack outputs..."
aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --region $REGION \
  --query 'Stacks[0].Outputs' \
  --output table

echo ""
echo "========================================="
echo "✅ Deployment complete for $ENVIRONMENT"
echo "========================================="
echo ""
echo "Resources created with suffix: -o-sp5-${ENVIRONMENT}"
echo "  - IAM Users: lf-lh-dev-user-o-sp5-${ENVIRONMENT}, lf-lh-super-user-o-sp5-${ENVIRONMENT}"
echo "  - S3 Bucket: lf-lh-silver-bkt-o-sp5-${ENVIRONMENT}"
echo "  - Glue DB: lf-lh-silver-db-o-sp5-${ENVIRONMENT}"
echo "  - Crawler: lf-lh-silver-crawler-o-sp5-${ENVIRONMENT}"
echo ""
echo "Lake Formation Tags (shared across all environments):"
echo "  - DBAccessScope-o-sp5: silver, gold"
echo "  - PII-o-sp5: true, false"
echo ""
echo "Next steps:"
echo "  1. Upload test data: aws s3 cp silver_members.csv s3://lf-lh-silver-bkt-o-sp5-${ENVIRONMENT}/members/"
echo "  2. Run crawler: aws glue start-crawler --name lf-lh-silver-crawler-o-sp5-${ENVIRONMENT}"
echo "  3. Tag PII columns: python tag_column_as_pii.py --db lf-lh-silver-db-o-sp5-${ENVIRONMENT} --table members --column ssn"
echo ""
