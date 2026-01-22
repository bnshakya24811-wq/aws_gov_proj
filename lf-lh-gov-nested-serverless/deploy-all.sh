#!/bin/bash

# Deploy all stacks in correct order for a specific environment

set -e

STAGE="${1:-dev}"
REGION="${2:-us-east-1}"

echo "========================================="
echo "Lake Formation Security-Gov Deploy"
echo "========================================="
echo "Environment: $STAGE"
echo "Region: $REGION"
echo "========================================="
echo ""

# Step 1: Deploy Stack 1 (Resources)
echo "Step 1/3: Deploying Stack 1 (Resources)..."
cd stack-1-resources
serverless deploy --stage ${STAGE} --region ${REGION}
echo "✅ Stack 1 deployed"
echo ""

# Step 2: Upload nested templates
echo "Step 2/3: Uploading nested stack templates..."
cd ../stack-2-security-gov
chmod +x upload-templates.sh
./upload-templates.sh ${STAGE} ${REGION}
echo "✅ Templates uploaded"
echo ""

# Step 3: Deploy Stack 2 (Security & Governance with Nested Stacks)
echo "Step 3/3: Deploying Stack 2 (Security & Governance)..."
serverless deploy --stage ${STAGE} --region ${REGION}
echo "✅ Stack 2 deployed"
echo ""

echo "========================================="
echo "✅ Deployment Complete for ${STAGE}"
echo "========================================="
echo ""
echo "Resources created:"
echo ""
echo "Security & Governance (nested stacks):"
echo "  ├── LF Tags: DBAccessScope-o-sp6, PII-o-sp6 (shared, environment-agnostic)"
echo "  ├── Tag associations: Database tagged with DBAccessScope-o-sp6=silver"
echo "  └── Permissions: LF policies for users/roles in ${STAGE} environment"
echo ""
echo "Resources (environment-specific):"
echo "  ├── Database: lf-lh-silver-db-o-sp6-${STAGE}"
echo "  ├── Bucket: lf-lh-silver-bkt-o-sp6-${STAGE}"
echo "  ├── IAM Users: lf-lh-dev-user-o-sp6-${STAGE}, lf-lh-super-user-o-sp6-${STAGE}"
echo "  └── Crawler: lf-lh-silver-crawler-o-sp6-${STAGE}"
echo ""
echo "Next steps:"
echo "  1. Revoke IAMAllowedPrincipals (see README.md)"
echo "  2. Upload test data: aws s3 cp silver_members.csv s3://lf-lh-silver-bkt-o-sp6-${STAGE}/members/"
echo "  3. Run crawler: aws glue start-crawler --name lf-lh-silver-crawler-o-sp6-${STAGE}"
echo "  4. Tag PII columns using tag_column_as_pii.py with tag key PII-o-sp6"
echo ""
