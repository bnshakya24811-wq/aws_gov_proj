#!/bin/bash
# Test OAuth Client Credentials Flow

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🧪 Testing OAuth Client Credentials Flow"
echo "========================================"

ENVIRONMENT=${1:-dev}
STACK_NAME="lf-client-creds-main-${ENVIRONMENT}"

# Get stack outputs
echo "📋 Getting stack configuration..."
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --query 'Stacks[0].Outputs[?OutputKey==`APIEndpoint`].OutputValue' \
  --output text)

USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --query 'Stacks[0].Outputs[?OutputKey==`CognitoUserPoolId`].OutputValue' \
  --output text)

ETL_CLIENT_ID=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --query 'Stacks[0].Outputs[?OutputKey==`ETLClientId`].OutputValue' \
  --output text)

REPORTING_CLIENT_ID=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --query 'Stacks[0].Outputs[?OutputKey==`ReportingClientId`].OutputValue' \
  --output text)

COGNITO_DOMAIN="lf-client-creds-${ENVIRONMENT}-$(aws sts get-caller-identity --query Account --output text)"
TOKEN_ENDPOINT="https://${COGNITO_DOMAIN}.auth.us-east-1.amazoncognito.com/oauth2/token"

echo -e "${GREEN}✅ Configuration loaded${NC}"
echo "API Endpoint: $API_ENDPOINT"
echo "Token Endpoint: $TOKEN_ENDPOINT"
echo ""

# Get client secrets
echo "🔐 Retrieving client secrets..."
ETL_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id lf-etl-client-secret-${ENVIRONMENT} \
  --query 'SecretString' --output text | jq -r '.client_secret')

REPORTING_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id lf-reporting-client-secret-${ENVIRONMENT} \
  --query 'SecretString' --output text | jq -r '.client_secret')

if [ "$ETL_SECRET" == "PLACEHOLDER_UPDATE_MANUALLY" ]; then
  echo -e "${RED}❌ Client secrets not updated. Run setup script first.${NC}"
  exit 1
fi

# Test 1: Get token for ETL client (write access)
echo ""
echo "Test 1: ETL Client - Get Access Token"
echo "--------------------------------------"

TOKEN_RESPONSE=$(curl -s -X POST ${TOKEN_ENDPOINT} \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "${ETL_CLIENT_ID}:${ETL_SECRET}" \
  -d "grant_type=client_credentials&scope=athena-api/query.read athena-api/query.write")

ETL_TOKEN=$(echo $TOKEN_RESPONSE | jq -r '.access_token')

if [ "$ETL_TOKEN" != "null" ] && [ -n "$ETL_TOKEN" ]; then
  echo -e "${GREEN}✅ Token received${NC}"
  echo "Token expires in: $(echo $TOKEN_RESPONSE | jq -r '.expires_in') seconds"
else
  echo -e "${RED}❌ Failed to get token${NC}"
  echo $TOKEN_RESPONSE | jq '.'
  exit 1
fi

# Test 2: Execute query with ETL token
echo ""
echo "Test 2: ETL Client - Execute Query"
echo "-----------------------------------"

QUERY_RESPONSE=$(curl -s -X POST ${API_ENDPOINT} \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ETL_TOKEN}" \
  -d "{
    \"query\": \"SELECT COUNT(*) as total FROM \\\"lf-lh-silver-db-o-sp6-${ENVIRONMENT}\\\".\\\"members\\\" LIMIT 1\"
  }")

if echo $QUERY_RESPONSE | jq -e '.success' > /dev/null 2>&1; then
  echo -e "${GREEN}✅ Query executed successfully${NC}"
  echo "Client ID: $(echo $QUERY_RESPONSE | jq -r '.clientId')"
  echo "LF Role: $(echo $QUERY_RESPONSE | jq -r '.lfRole')"
  echo "Results:"
  echo $QUERY_RESPONSE | jq '.data'
else
  echo -e "${RED}❌ Query failed${NC}"
  echo $QUERY_RESPONSE | jq '.'
fi

# Test 3: Reporting client (read-only)
echo ""
echo "Test 3: Reporting Client - Get Token & Query"
echo "---------------------------------------------"

REPORTING_TOKEN_RESPONSE=$(curl -s -X POST ${TOKEN_ENDPOINT} \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "${REPORTING_CLIENT_ID}:${REPORTING_SECRET}" \
  -d "grant_type=client_credentials&scope=athena-api/query.read")

REPORTING_TOKEN=$(echo $REPORTING_TOKEN_RESPONSE | jq -r '.access_token')

if [ "$REPORTING_TOKEN" != "null" ] && [ -n "$REPORTING_TOKEN" ]; then
  echo -e "${GREEN}✅ Reporting client token received${NC}"
  
  REPORTING_QUERY=$(curl -s -X POST ${API_ENDPOINT} \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${REPORTING_TOKEN}" \
    -d "{
      \"query\": \"SELECT * FROM \\\"lf-lh-silver-db-o-sp6-${ENVIRONMENT}\\\".\\\"members\\\" LIMIT 3\"
    }")
  
  if echo $REPORTING_QUERY | jq -e '.success' > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Reporting query successful${NC}"
    echo "Row count: $(echo $REPORTING_QUERY | jq -r '.rowCount')"
  else
    echo -e "${RED}❌ Reporting query failed${NC}"
    echo $REPORTING_QUERY | jq '.'
  fi
else
  echo -e "${RED}❌ Failed to get reporting token${NC}"
fi

# Test 4: Invalid token
echo ""
echo "Test 4: Invalid Token (should fail)"
echo "------------------------------------"

INVALID_RESPONSE=$(curl -s -X POST ${API_ENDPOINT} \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer invalid_token_12345" \
  -d '{"query": "SELECT 1"}')

if echo $INVALID_RESPONSE | jq -e '.success == false' > /dev/null 2>&1; then
  echo -e "${GREEN}✅ Correctly rejected invalid token${NC}"
else
  echo -e "${YELLOW}⚠️  Unexpected response${NC}"
  echo $INVALID_RESPONSE | jq '.'
fi

echo ""
echo "========================================"
echo -e "${GREEN}🎉 Testing complete!${NC}"
