#!/bin/bash
set -e

# Quick deploy script for updating Lambda code directly
# Usage: ./quick-deploy.sh <environment>
# Note: Lambda function must already exist

ENVIRONMENT=${1:-"dev"}
FUNCTION_NAME="lf-athena-query-handler-o-sp6-${ENVIRONMENT}"

echo "🔨 Building TypeScript Lambda for quick deployment..."

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
fi

# Build TypeScript
echo "🏗️  Compiling TypeScript..."
npm run build

# Create deployment package
echo "📦 Creating deployment package..."
cd dist
rm -f ../lambda.zip
zip -r ../lambda.zip . -x "*.map"
cd ..

# Update Lambda function directly
echo "☁️  Updating Lambda function: ${FUNCTION_NAME}..."
aws lambda update-function-code \
  --function-name "${FUNCTION_NAME}" \
  --zip-file fileb://lambda.zip

echo "✅ Lambda function updated successfully!"
echo ""
echo "Testing the function:"
echo "  curl -X POST https://YOUR_API_ENDPOINT/dev/query \\"
echo "    -H \"x-api-key: YOUR_API_KEY\" \\"
echo "    -H \"Content-Type: application/json\" \\"
echo "    -d '{\"tableName\": \"lf_lh_silver_bkt_o_sp5_dev\", \"limit\": 5}'"
