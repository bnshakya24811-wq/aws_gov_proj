#!/bin/bash

# Deploy Security Governance Stack for Multiple Environments
# This script deploys the account-level governance stack for each environment

set -e

REGION="${1:-us-east-1}"
ENVIRONMENTS=("dev" "uat" "prod")

echo "=========================================="
echo "Stack 2: Security Governance Deployment"
echo "=========================================="
echo "Region: $REGION"
echo ""

# Step 1: Create S3 bucket for nested templates (one-time operation)
echo "Step 1: Ensuring S3 bucket exists..."
BUCKET_NAME="lf-nested-templates-o-sp6"

if aws s3 ls "s3://$BUCKET_NAME" 2>/dev/null; then
    echo "✓ Bucket $BUCKET_NAME already exists"
else
    echo "Creating bucket $BUCKET_NAME..."
    aws s3 mb "s3://$BUCKET_NAME" --region "$REGION"
    echo "✓ Bucket created"
fi
echo ""

# Step 2: Upload nested stack templates
echo "Step 2: Uploading nested stack templates..."
aws s3 cp nested/ "s3://$BUCKET_NAME/nested/" --recursive
echo "✓ Templates uploaded"
echo ""

# Step 3: Deploy governance stack for each environment
echo "Step 3: Deploying governance stack..."
echo ""

for ENV in "${ENVIRONMENTS[@]}"; do
    echo "----------------------------------------"
    echo "Deploying for environment: $ENV"
    echo "----------------------------------------"
    
    # Check if Stack 1 resources exist for this environment
    SSM_PARAM="/lf-lh/$ENV/resources/database-name"
    if aws ssm get-parameter --name "$SSM_PARAM" --region "$REGION" 2>/dev/null; then
        echo "✓ Found Stack 1 resources for $ENV"
        
        # Deploy with environment parameter
        echo "Deploying governance stack with Environment=$ENV..."
        serverless deploy --region "$REGION" --param="Environment=$ENV"
        
        echo "✓ Governance stack deployed for $ENV"
    else
        echo "⚠ Warning: Stack 1 resources not found for $ENV"
        echo "  Please deploy stack-1-resources for $ENV first:"
        echo "  cd ../stack-1-resources && serverless deploy --stage $ENV --region $REGION"
    fi
    
    echo ""
done

echo "=========================================="
echo "Deployment Summary"
echo "=========================================="
echo "Stack Name: lf-lh-stack-2-security-gov-o-sp6"
echo "Nested Stacks:"
echo "  - LF Tags (account-level): Shared across all environments"
echo "  - Tag Associations: Environment-specific"
echo "  - Permissions: Environment-specific"
echo ""
echo "To view stack outputs:"
echo "  aws cloudformation describe-stacks \\"
echo "    --stack-name lf-lh-stack-2-security-gov-o-sp6 \\"
echo "    --region $REGION \\"
echo "    --query 'Stacks[0].Outputs'"
echo ""
