#!/bin/bash
# Upload all templates and Lambda code to S3

BUCKET="deployment-bkt"
REGION="us-east-1"

echo "Uploading to s3://${BUCKET}..."

# Upload Lambda code
echo "Uploading Lambda code..."
aws s3 cp lambdas/athena-query-handler.zip s3://${BUCKET}/lambda/athena-query-handler.zip

# Upload nested stack templates
echo "Uploading nested stack templates..."
aws s3 cp iam-stack.yaml s3://${BUCKET}/lf-nested-stacks/iam-stack.yaml
aws s3 cp glue-stack.yaml s3://${BUCKET}/lf-nested-stacks/glue-stack.yaml
aws s3 cp governance-stack.yaml s3://${BUCKET}/lf-nested-stacks/governance-stack.yaml
aws s3 cp lambda-stack.yaml s3://${BUCKET}/lf-nested-stacks/lambda-stack.yaml
aws s3 cp api-stack.yaml s3://${BUCKET}/lf-nested-stacks/api-stack.yaml
aws s3 cp dynamodb-stack.yaml s3://${BUCKET}/lf-nested-stacks/dynamodb-stack.yaml

echo "✅ Upload complete!"
echo ""
echo "Files uploaded to:"
echo "  s3://${BUCKET}/lambda/athena-query-handler.zip"
echo "  s3://${BUCKET}/lf-nested-stacks/*.yaml"
