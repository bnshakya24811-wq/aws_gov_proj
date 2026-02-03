#!/bin/bash
# Test script for hash-based API key validation

set -e

API_ENDPOINT="${API_ENDPOINT:-https://xxxxx.execute-api.us-east-1.amazonaws.com/dev/query}"
SECRET_NAME="${SECRET_NAME:-lf-apikey-dev-user-apk-dev}"

echo "================================================"
echo "Hash-Based API Key Validation Test"
echo "================================================"

# Step 1: Retrieve API key from Secrets Manager
echo ""
echo "Step 1: Retrieving API key from Secrets Manager..."
SECRET_JSON=$(aws secretsmanager get-secret-value \
    --secret-id "$SECRET_NAME" \
    --query SecretString \
    --output text)

API_KEY=$(echo "$SECRET_JSON" | jq -r '.apiKey')
USER_NAME=$(echo "$SECRET_JSON" | jq -r '.userName')
API_KEY_HASH=$(echo "$SECRET_JSON" | jq -r '.apiKeyHash')

echo "  User: $USER_NAME"
echo "  API Key Hash: $API_KEY_HASH"
echo "  API Key: ${API_KEY:0:8}...${API_KEY: -4}"

# Step 2: Test the API endpoint
echo ""
echo "Step 2: Testing API endpoint with API key..."
echo "  Endpoint: $API_ENDPOINT"

RESPONSE=$(curl -s -X POST "$API_ENDPOINT" \
    -H "Content-Type: application/json" \
    -H "x-api-key: $API_KEY" \
    -d '{
        "tableName": "members",
        "database": "lf-lh-silver-db-apk-dev",
        "limit": 5
    }')

echo ""
echo "Response:"
echo "$RESPONSE" | jq '.'

# Step 3: Verify hash locally
echo ""
echo "Step 3: Verifying hash calculation..."
LOCAL_HASH=$(echo -n "$API_KEY" | sha256sum | awk '{print $1}')
echo "  Local hash:  $LOCAL_HASH"
echo "  Stored hash: $API_KEY_HASH"

if [ "$LOCAL_HASH" == "$API_KEY_HASH" ]; then
    echo "  ✅ Hash matches!"
else
    echo "  ❌ Hash mismatch!"
fi

echo ""
echo "================================================"
echo "Flow Summary:"
echo "================================================"
echo "1. Client sends:    x-api-key: $API_KEY"
echo "2. Lambda hashes:   sha256 → $LOCAL_HASH"
echo "3. DynamoDB lookup: apiKeyHash → roleArn"
echo "4. Assume role:     roleArn → credentials"
echo "5. Execute query:   Athena with LF permissions"
echo "================================================"
