#!/bin/bash
# Test script for API Key solution

ENVIRONMENT=${1:-dev}
REGION=${2:-us-east-1}

echo "==================================="
echo "API Key Solution Test"
echo "==================================="
echo "Environment: $ENVIRONMENT"
echo ""

# Get API endpoint and key
echo "Fetching API details..."
API_STACK_NAME="lf-api-apikey-${ENVIRONMENT}"

API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name "$API_STACK_NAME" \
  --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`QueryEndpoint`].OutputValue' \
  --output text)

API_KEY_ID=$(aws cloudformation describe-stacks \
  --stack-name "$API_STACK_NAME" \
  --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`DemoApiKeyId`].OutputValue' \
  --output text)

API_KEY=$(aws apigateway get-api-key \
  --api-key "$API_KEY_ID" \
  --include-value \
  --region $REGION \
  --query 'value' \
  --output text)

echo "Endpoint: $API_ENDPOINT"
echo "API Key: ${API_KEY:0:20}..."
echo ""

# Test 1: Valid request
echo "==================================="
echo "Test 1: Valid API Key Request"
echo "==================================="
curl -X POST "$API_ENDPOINT" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tableName": "members",
    "limit": 5
  }' \
  -w "\n\nStatus: %{http_code}\n" \
  -s | jq .

echo ""

# Test 2: Missing API key
echo "==================================="
echo "Test 2: Missing API Key"
echo "==================================="
curl -X POST "$API_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{"tableName": "members"}' \
  -w "\n\nStatus: %{http_code}\n" \
  -s | jq .

echo ""

# Test 3: Invalid API key
echo "==================================="
echo "Test 3: Invalid API Key"
echo "==================================="
curl -X POST "$API_ENDPOINT" \
  -H "x-api-key: invalid-key-12345" \
  -H "Content-Type: application/json" \
  -d '{"tableName": "members"}' \
  -w "\n\nStatus: %{http_code}\n" \
  -s | jq .

echo ""

# Test 4: Missing table name
echo "==================================="
echo "Test 4: Missing Table Name"
echo "==================================="
curl -X POST "$API_ENDPOINT" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"limit": 10}' \
  -w "\n\nStatus: %{http_code}\n" \
  -s | jq .

echo ""
echo "==================================="
echo "Tests Complete"
echo "==================================="
