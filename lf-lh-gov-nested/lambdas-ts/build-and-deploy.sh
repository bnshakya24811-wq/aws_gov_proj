#!/bin/bash
set -e

# Build and deploy TypeScript Lambda to S3
# Usage: ./build-and-deploy.sh <s3-bucket> <environment>

S3_BUCKET=${1:-"your-lambda-code-bucket"}
ENVIRONMENT=${2:-"dev"}
S3_KEY="lambda/athena-query-handler.zip"

echo "🔨 Building TypeScript Lambda..."

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build TypeScript
echo "🏗️  Compiling TypeScript..."
npm run build

# Create deployment package
echo "📦 Creating deployment package..."
cd dist
zip -r ../lambda.zip . -x "*.map"
cd ..

# Upload to S3
echo "☁️  Uploading to S3..."
aws s3 cp lambda.zip "s3://${S3_BUCKET}/${S3_KEY}"

echo "✅ Lambda package uploaded to s3://${S3_BUCKET}/${S3_KEY}"
echo ""
echo "Next steps:"
echo "1. Update CloudFormation stack with LambdaCodeS3Bucket=${S3_BUCKET}"
echo "2. Deploy/update the lambda-stack"
echo ""
echo "Example:"
echo "  aws cloudformation update-stack \\"
echo "    --stack-name lf-lh-lambda-stack-o-sp6-${ENVIRONMENT} \\"
echo "    --use-previous-template \\"
echo "    --parameters ParameterKey=LambdaCodeS3Bucket,ParameterValue=${S3_BUCKET} \\"
echo "    --capabilities CAPABILITY_NAMED_IAM"
