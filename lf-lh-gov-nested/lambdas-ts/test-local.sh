#!/bin/bash
set -e

# Test the Lambda function locally
# Requires AWS SAM CLI: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html

echo "🧪 Testing Lambda function locally with SAM..."

# Build first
echo "🔨 Building..."
npm run build

# Create test event
cat > test-event.json << 'EOF'
{
  "headers": {
    "x-api-key": "test-api-key-12345"
  },
  "body": "{\"tableName\": \"lf_lh_silver_bkt_o_sp5_dev\", \"limit\": 5}"
}
EOF

# Set environment variables for local testing
export API_KEY_TABLE="lf-api-key-mappings-o-sp6-dev"
export DATABASE_NAME="lf-lh-silver-db-o-sp5-dev"
export ATHENA_OUTPUT_BUCKET="s3://aws-athena-query-results-YOUR_ACCOUNT-YOUR_REGION/"
export REGION="ap-southeast-2"
export LOG_LEVEL="DEBUG"

echo "📝 Test event:"
cat test-event.json

echo ""
echo "🚀 Invoking function..."
echo "Note: This requires valid AWS credentials with access to DynamoDB, STS, and Athena"

# Note: For true local testing, you'd need to mock AWS services
# This is just a syntax/build check
node -e "
const handler = require('./dist/index').handler;
const event = require('./test-event.json');

handler(event, { requestId: 'test-123', functionName: 'test' })
  .then(result => console.log('Response:', JSON.stringify(result, null, 2)))
  .catch(err => console.error('Error:', err));
"
