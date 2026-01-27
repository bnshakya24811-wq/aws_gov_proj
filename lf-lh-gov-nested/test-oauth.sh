#!/bin/bash
# Test OAuth authentication endpoint

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🧪 Testing OAuth Authentication Endpoint"
echo "========================================"
echo ""

# Get stack outputs
STACK_NAME=${1:-lf-lh-nested-o-sp6-dev}

echo "📋 Getting stack outputs for: $STACK_NAME"
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query 'Stacks[0].Outputs[?OutputKey==`APIEndpointOAuth`].OutputValue' \
  --output text 2>/dev/null)

if [ -z "$API_ENDPOINT" ] || [ "$API_ENDPOINT" == "OAuth not enabled" ]; then
    echo -e "${RED}❌ OAuth endpoint not found. Make sure stack is deployed with EnableOAuth=true${NC}"
    exit 1
fi

echo -e "${GREEN}✅ API Endpoint: $API_ENDPOINT${NC}"
echo ""

# Test 1: Missing credentials
echo "Test 1: Missing credentials (should fail)"
echo "-------------------------------------------"
RESPONSE=$(curl -s -X POST $API_ENDPOINT \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT * FROM test"
  }')

if echo $RESPONSE | grep -q "Missing authentication credentials"; then
    echo -e "${GREEN}✅ Correctly rejected missing credentials${NC}"
else
    echo -e "${RED}❌ Unexpected response: $RESPONSE${NC}"
fi
echo ""

# Test 2: Invalid credentials
echo "Test 2: Invalid credentials (should fail)"
echo "-------------------------------------------"
RESPONSE=$(curl -s -X POST $API_ENDPOINT \
  -H "Content-Type: application/json" \
  -d '{
    "username": "fake-user@example.com",
    "password": "WrongPassword123!",
    "query": "SELECT * FROM test"
  }')

if echo $RESPONSE | grep -q "Authentication failed"; then
    echo -e "${GREEN}✅ Correctly rejected invalid credentials${NC}"
else
    echo -e "${YELLOW}⚠️  Response: $RESPONSE${NC}"
fi
echo ""

# Test 3: Valid developer user
echo "Test 3: Valid developer user"
echo "-------------------------------------------"
read -p "Enter developer username (e.g., dev-user@example.com): " DEV_USERNAME
read -sp "Enter developer password: " DEV_PASSWORD
echo ""

if [ -z "$DEV_USERNAME" ] || [ -z "$DEV_PASSWORD" ]; then
    echo -e "${YELLOW}⚠️  Skipping developer user test (no credentials provided)${NC}"
else
    RESPONSE=$(curl -s -X POST $API_ENDPOINT \
      -H "Content-Type: application/json" \
      -d "{
        \"username\": \"$DEV_USERNAME\",
        \"password\": \"$DEV_PASSWORD\",
        \"query\": \"SELECT COUNT(*) as count FROM \\\"lf-lh-silver-db-o-sp6-dev\\\".\\\"members\\\" LIMIT 1\"
      }")

    if echo $RESPONSE | grep -q '"success":true'; then
        echo -e "${GREEN}✅ Successfully authenticated and executed query${NC}"
        echo "Response preview:"
        echo $RESPONSE | jq -r '.authenticatedUser, .userGroups, .lfRole' 2>/dev/null || echo $RESPONSE
    else
        echo -e "${RED}❌ Query failed${NC}"
        echo $RESPONSE | jq '.' 2>/dev/null || echo $RESPONSE
    fi
fi
echo ""

# Test 4: Query with different Lake Formation permissions
echo "Test 4: Testing Lake Formation permissions"
echo "-------------------------------------------"
read -p "Test PII column access? (y/n): " TEST_PII

if [ "$TEST_PII" == "y" ] && [ -n "$DEV_USERNAME" ]; then
    echo "Attempting to query SSN column (should fail for dev users)..."
    RESPONSE=$(curl -s -X POST $API_ENDPOINT \
      -H "Content-Type: application/json" \
      -d "{
        \"username\": \"$DEV_USERNAME\",
        \"password\": \"$DEV_PASSWORD\",
        \"query\": \"SELECT ssn FROM \\\"lf-lh-silver-db-o-sp6-dev\\\".\\\"members\\\" LIMIT 1\"
      }")

    if echo $RESPONSE | grep -q "AccessDeniedException\|insufficient permissions"; then
        echo -e "${GREEN}✅ Correctly blocked PII access for developer${NC}"
    elif echo $RESPONSE | grep -q '"success":true'; then
        echo -e "${YELLOW}⚠️  Developer has PII access (check Lake Formation permissions)${NC}"
    else
        echo -e "${RED}Response: $RESPONSE${NC}"
    fi
fi
echo ""

echo "========================================"
echo "🏁 Test completed"
echo ""
echo "💡 Tips:"
echo "   - Create users: aws cognito-idp admin-create-user --user-pool-id \$USER_POOL_ID ..."
echo "   - View logs: aws logs tail /aws/lambda/lf-oauth-query-handler-o-sp6-dev --follow"
echo "   - Check permissions: aws lakeformation list-permissions ..."
