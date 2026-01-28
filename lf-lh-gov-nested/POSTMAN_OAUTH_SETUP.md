# Postman Setup for OAuth Authentication

This guide will help you configure Postman to test the OAuth 2.0 authentication endpoint for the Lake Formation Access Control API.

## Prerequisites

1. Stack deployed with `EnableOAuth=true`
2. Cognito users created (dev-user, admin-user)
3. API endpoint URL from CloudFormation outputs

## Step 1: Get Required Information

Run these commands to get the necessary configuration:

```bash
# Set your stack name
STACK_NAME="lf-lh-nested-o-sp6-dev"

# Get OAuth API endpoint
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query 'Stacks[0].Outputs[?OutputKey==`APIEndpointOAuth`].OutputValue' \
  --output text)

echo "API Endpoint: $API_ENDPOINT"

# Get Cognito User Pool ID (for reference)
USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query 'Stacks[0].Outputs[?OutputKey==`CognitoUserPoolId`].OutputValue' \
  --output text)

echo "User Pool ID: $USER_POOL_ID"
```

Save these values - you'll need them for Postman configuration.

## Step 2: Create Postman Collection

1. **Open Postman** and create a new collection
2. **Name it**: `Lake Formation OAuth API`
3. **Add description**: `OAuth 2.0 authentication for Athena queries with Lake Formation TBAC`

## Step 3: Configure Collection Variables

In your collection, go to the **Variables** tab and add:

| Variable Name | Initial Value | Current Value | Type |
|--------------|---------------|---------------|------|
| `oauth_endpoint` | `https://xxxxx.execute-api.us-east-1.amazonaws.com/dev/query-oauth` | (same) | default |
| `dev_username` | `dev-user@example.com` | (same) | default |
| `dev_password` | `YourDevPassword123!` | (same) | secret |
| `admin_username` | `admin-user@example.com` | (same) | default |
| `admin_password` | `YourAdminPassword123!` | (same) | secret |
| `database_name` | `lf-lh-silver-db-o-sp6-dev` | (same) | default |
| `table_name` | `members` | (same) | default |

**Note**: Replace the placeholder values with your actual API endpoint and user credentials.

## Step 4: Create Requests

### Request 1: Developer User - Basic Query

**Name**: `OAuth - Dev User - Count Query`

**Method**: `POST`

**URL**: `{{oauth_endpoint}}`

**Headers**:
```
Content-Type: application/json
```

**Body** (raw JSON):
```json
{
  "username": "{{dev_username}}",
  "password": "{{dev_password}}",
  "query": "SELECT COUNT(*) as total_members FROM \"{{database_name}}\".\"{{table_name}}\" LIMIT 10"
}
```

**Tests** (Optional - for automation):
```javascript
pm.test("Status code is 200", function () {
    pm.response.to.have.status(200);
});

pm.test("Response has success flag", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.eql(true);
});

pm.test("Contains query results", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.results).to.exist;
});
```

---

### Request 2: Developer User - Select All Columns

**Name**: `OAuth - Dev User - Select All`

**Method**: `POST`

**URL**: `{{oauth_endpoint}}`

**Headers**:
```
Content-Type: application/json
```

**Body** (raw JSON):
```json
{
  "username": "{{dev_username}}",
  "password": "{{dev_password}}",
  "query": "SELECT * FROM \"{{database_name}}\".\"{{table_name}}\" LIMIT 5"
}
```

**Expected Result**: Non-PII columns only (if PII tags are configured)

---

### Request 3: Developer User - PII Column Access (Should Fail)

**Name**: `OAuth - Dev User - PII Access Test`

**Method**: `POST`

**URL**: `{{oauth_endpoint}}`

**Headers**:
```
Content-Type: application/json
```

**Body** (raw JSON):
```json
{
  "username": "{{dev_username}}",
  "password": "{{dev_password}}",
  "query": "SELECT ssn, email FROM \"{{database_name}}\".\"{{table_name}}\" LIMIT 1"
}
```

**Expected Result**: Access denied or filtered results (if dev user doesn't have PII permissions)

**Tests** (Optional):
```javascript
pm.test("Dev user blocked from PII", function () {
    var jsonData = pm.response.json();
    // Either fails or succeeds with empty/filtered results
    pm.expect(jsonData.success === false || jsonData.results.length === 0).to.be.true;
});
```

---

### Request 4: Admin User - Full Access

**Name**: `OAuth - Admin User - Full Query`

**Method**: `POST`

**URL**: `{{oauth_endpoint}}`

**Headers**:
```
Content-Type: application/json
```

**Body** (raw JSON):
```json
{
  "username": "{{admin_username}}",
  "password": "{{admin_password}}",
  "query": "SELECT * FROM \"{{database_name}}\".\"{{table_name}}\" LIMIT 5"
}
```

**Expected Result**: All columns including PII (if admin is in Admins group)

---

### Request 5: Invalid Credentials Test

**Name**: `OAuth - Invalid Credentials`

**Method**: `POST`

**URL**: `{{oauth_endpoint}}`

**Headers**:
```
Content-Type: application/json
```

**Body** (raw JSON):
```json
{
  "username": "fake-user@example.com",
  "password": "WrongPassword123!",
  "query": "SELECT * FROM \"{{database_name}}\".\"{{table_name}}\" LIMIT 1"
}
```

**Expected Result**: Authentication error

**Tests**:
```javascript
pm.test("Authentication fails with invalid credentials", function () {
    var jsonData = pm.response.json();
    pm.expect(jsonData.success).to.eql(false);
    pm.expect(jsonData.error).to.include("Authentication failed");
});
```

---

### Request 6: Missing Credentials Test

**Name**: `OAuth - Missing Credentials`

**Method**: `POST`

**URL**: `{{oauth_endpoint}}`

**Headers**:
```
Content-Type: application/json
```

**Body** (raw JSON):
```json
{
  "query": "SELECT * FROM \"{{database_name}}\".\"{{table_name}}\" LIMIT 1"
}
```

**Expected Result**: Error about missing credentials

---

## Step 5: Environment Setup (Optional)

If you have multiple environments (dev, staging, prod), create Postman environments:

### Dev Environment
```
oauth_endpoint: https://xxxxx.execute-api.us-east-1.amazonaws.com/dev/query-oauth
database_name: lf-lh-silver-db-o-sp6-dev
```

### Staging Environment
```
oauth_endpoint: https://yyyyy.execute-api.us-east-1.amazonaws.com/staging/query-oauth
database_name: lf-lh-silver-db-o-sp6-staging
```

## Step 6: Run Collection

1. **Single Request**: Click on any request and hit "Send"
2. **Collection Runner**: 
   - Click on your collection → "Run"
   - Select all requests
   - Click "Run Lake Formation OAuth API"
   - View results with pass/fail tests

## Expected Response Format

### Success Response
```json
{
  "success": true,
  "authenticatedUser": "dev-user@example.com",
  "userGroups": ["Developers"],
  "lfRole": "arn:aws:iam::123456789012:role/lf-dev-user-role-o-sp6-dev",
  "queryExecutionId": "abc123-...",
  "results": [
    {
      "column1": "value1",
      "column2": "value2"
    }
  ],
  "resultCount": 1
}
```

### Error Response
```json
{
  "success": false,
  "error": "Authentication failed: Incorrect username or password.",
  "details": "..."
}
```

## Troubleshooting

### Issue: "OAuth endpoint not found"
**Solution**: Ensure stack was deployed with `EnableOAuth=true`
```bash
aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query 'Stacks[0].Parameters[?ParameterKey==`EnableOAuth`].ParameterValue'
```

### Issue: "User does not exist"
**Solution**: Create Cognito user first
```bash
aws cognito-idp admin-create-user \
  --user-pool-id $USER_POOL_ID \
  --username dev-user@example.com \
  --user-attributes Name=email,Value=dev-user@example.com Name=email_verified,Value=true \
  --temporary-password "TempPassword123!" \
  --message-action SUPPRESS

# Set permanent password
aws cognito-idp admin-set-user-password \
  --user-pool-id $USER_POOL_ID \
  --username dev-user@example.com \
  --password "YourPassword123!" \
  --permanent
```

### Issue: "NotAuthorizedException - Password attempts exceeded"
**Solution**: Wait or reset password
```bash
aws cognito-idp admin-reset-user-password \
  --user-pool-id $USER_POOL_ID \
  --username dev-user@example.com
```

### Issue: Query succeeds but PII column returns empty
**Solution**: Check Lake Formation tags are applied
```bash
# View column tags
aws lakeformation get-resource-lf-tags \
  --resource '{
    "TableWithColumns": {
      "DatabaseName": "lf-lh-silver-db-o-sp6-dev",
      "Name": "members",
      "ColumnNames": ["ssn", "email"]
    }
  }'
```

## Advanced: Pre-request Scripts

Add this to collection's **Pre-request Script** to auto-rotate passwords or manage tokens:

```javascript
// Example: Auto-select user based on test scenario
const testType = pm.collectionVariables.get("current_test");

if (testType === "pii_test") {
    pm.collectionVariables.set("current_username", pm.collectionVariables.get("admin_username"));
    pm.collectionVariables.set("current_password", pm.collectionVariables.get("admin_password"));
} else {
    pm.collectionVariables.set("current_username", pm.collectionVariables.get("dev_username"));
    pm.collectionVariables.set("current_password", pm.collectionVariables.get("dev_password"));
}
```

## Security Best Practices

1. **Never commit passwords** to version control
2. Use Postman **secret variables** for passwords
3. Consider using **Postman Vault** for sensitive data
4. Enable **MFA** for Cognito users in production
5. Rotate passwords regularly
6. Use **environment-specific** variables

## Next Steps

- Import the collection: File → Import → Paste this guide's JSON (if exported)
- Test different Lake Formation permissions
- Validate Column-Level Security (PII tags)
- Check CloudWatch Logs for debugging: `/aws/lambda/lf-oauth-query-handler-o-sp6-dev`

## Related Documentation

- [OAUTH_GUIDE.md](./OAUTH_GUIDE.md) - Full OAuth implementation details
- [API_GUIDE.md](./API_GUIDE.md) - API architecture and deployment
- [test-oauth.sh](./test-oauth.sh) - Automated testing script
