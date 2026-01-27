#!/bin/bash

# Example: Deploy governance stack for a single environment

set -e

ENVIRONMENT="${1:-dev}"
REGION="${2:-us-east-1}"

echo "=========================================="
echo "Deploying Governance Stack"
echo "=========================================="
echo "Environment: $ENVIRONMENT"
echo "Region: $REGION"
echo ""

# Step 1: Upload nested templates
echo "Step 1: Uploading nested stack templates to S3..."
BUCKET_NAME="lf-nested-templates-o-sp6"

# Create bucket if it doesn't exist
if ! aws s3 ls "s3://$BUCKET_NAME" 2>/dev/null; then
    echo "Creating S3 bucket: $BUCKET_NAME"
    aws s3 mb "s3://$BUCKET_NAME" --region "$REGION"
fi

# Upload templates
aws s3 cp nested/ "s3://$BUCKET_NAME/nested/" --recursive
echo "✓ Templates uploaded"
echo ""

# Step 2: Verify Stack 1 resources exist
echo "Step 2: Verifying Stack 1 resources for $ENVIRONMENT..."
SSM_PARAM="/lf-lh/$ENVIRONMENT/resources/database-name"

if aws ssm get-parameter --name "$SSM_PARAM" --region "$REGION" &>/dev/null; then
    DB_NAME=$(aws ssm get-parameter --name "$SSM_PARAM" --region "$REGION" --query 'Parameter.Value' --output text)
    echo "✓ Found database: $DB_NAME"
else
    echo "❌ Error: Stack 1 resources not found for $ENVIRONMENT"
    echo "Please deploy stack-1-resources first:"
    echo "  cd ../stack-1-resources"
    echo "  serverless deploy --stage $ENVIRONMENT --region $REGION"
    exit 1
fi
echo ""

# Step 3: Deploy governance stack
echo "Step 3: Deploying governance stack with Environment=$ENVIRONMENT..."
serverless deploy --region "$REGION" --param="Environment=$ENVIRONMENT"

echo ""
echo "=========================================="
echo "✓ Deployment Complete"
echo "=========================================="
echo ""
echo "Stack Details:"
echo "  Name: lf-lh-stack-2-security-gov-o-sp6"
echo "  Environment: $ENVIRONMENT"
echo "  Region: $REGION"
echo ""
echo "Nested Stacks Created/Updated:"
echo "  1. LF Tags (account-level) - Shared across all environments"
echo "  2. Tag Associations - Configured for $ENVIRONMENT"
echo "  3. Permissions - Configured for $ENVIRONMENT"
echo ""
echo "View stack outputs:"
echo "  aws cloudformation describe-stacks \\"
echo "    --stack-name lf-lh-stack-2-security-gov-o-sp6 \\"
echo "    --region $REGION \\"
echo "    --query 'Stacks[0].Outputs' \\"
echo "    --output table"
echo ""
