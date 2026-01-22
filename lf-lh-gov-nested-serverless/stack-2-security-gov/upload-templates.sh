#!/bin/bash

# Upload nested CloudFormation templates to S3 before deploying stack-2

set -e

STAGE="${1:-dev}"
REGION="${2:-us-east-1}"
BUCKET="lf-nested-templates-o-sp6-${STAGE}"

echo "========================================="
echo "Upload Nested Stack Templates"
echo "========================================="
echo "Stage: $STAGE"
echo "Bucket: $BUCKET"
echo "Region: $REGION"
echo "========================================="
echo ""

# Check if bucket exists (it will be created by stack-2, but we can pre-create)
if ! aws s3 ls s3://${BUCKET} 2>/dev/null; then
  echo "Creating S3 bucket: ${BUCKET}"
  aws s3 mb s3://${BUCKET} --region ${REGION}
else
  echo "Bucket ${BUCKET} already exists"
fi

# Upload nested templates
echo "Uploading nested stack templates..."
aws s3 cp nested/lf-tags-stack.yaml s3://${BUCKET}/nested/lf-tags-stack.yaml --region ${REGION}
aws s3 cp nested/tag-associations-stack.yaml s3://${BUCKET}/nested/tag-associations-stack.yaml --region ${REGION}
aws s3 cp nested/permissions-stack.yaml s3://${BUCKET}/nested/permissions-stack.yaml --region ${REGION}

echo ""
echo "✅ Templates uploaded successfully to s3://${BUCKET}/nested/"
echo ""
echo "Nested stacks:"
echo "  1. lf-tags-stack.yaml - Creates LF tags (DBAccessScope-o-sp6, PII-o-sp6)"
echo "  2. tag-associations-stack.yaml - Associates tags with database"
echo "  3. permissions-stack.yaml - Grants LF permissions to users/roles"
echo ""
echo "You can now deploy stack-2-security-gov:"
echo "  cd stack-2-security-gov"
echo "  serverless deploy --stage ${STAGE} --region ${REGION}"
