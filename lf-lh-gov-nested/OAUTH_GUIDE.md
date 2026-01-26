# OAuth 2.0 Authentication with AWS Cognito

## Overview

This implementation adds OAuth 2.0 authentication using AWS Cognito to the Lake Formation access control API. It follows the **OAuth Proxy Pattern** where:

1. Client sends username/password (or client credentials) to the API
2. Lambda exchanges credentials for OAuth tokens with Cognito
3. Lambda validates tokens and maps user to Lake Formation role
4. Lambda executes Athena query with appropriate Lake Formation permissions

## Architecture

```
Client → API Gateway → Lambda (OAuth Proxy) → Cognito → Lambda assumes LF role → Athena
```

## Components

### 1. Cognito User Pool (`cognito-stack.yaml`)
- **User Pool**: Manages user identities
- **App Client**: Configured for USER_PASSWORD_AUTH flow
- **User Groups**:
  - `Admins` → Maps to LF Super User role
  - `Developers` → Maps to LF Dev User role
  - `Analysts` → Maps to LF Dev User role
  - `DataScientists` → Maps to LF Dev User role

### 2. OAuth Lambda Function (`lambdas-oauth/index.py`)
- **Authentication**: Authenticates users with Cognito
- **Token Validation**: Validates JWT tokens
- **Role Mapping**: Maps Cognito groups to Lake Formation roles
- **Query Execution**: Assumes LF role and executes Athena queries

### 3. API Gateway Route
- **Endpoint**: `POST /query-oauth`
- **Authentication**: None (handled by Lambda)
- **Request Body**:
  ```json
  {
    "username": "dev-user@example.com",
    "password": "Password123!",
    "query": "SELECT * FROM database.table LIMIT 10"
  }
  ```

## Deployment

### Prerequisites

1. **Upload templates to S3**:
   ```bash
   ./upload-templates.sh
   ```

2. **Build OAuth Lambda**:
   ```bash
   chmod +x build-oauth-lambda.sh
   ./build-oauth-lambda.sh
   ```

3. **Upload Lambda ZIP to S3**:
   ```bash
   aws s3 cp build/oauth-query-handler.zip s3://deploymen-bkt/lambda/
   ```

### Deploy with OAuth Enabled

```bash
aws cloudformation deploy \
  --template-file main.yaml \
  --stack-name lf-lh-nested-o-sp6-dev \
  --parameter-overrides \
    Environment=dev \
    EnableOAuth=true \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1
```

### Post-Deployment: Create Cognito Users

1. **Get Cognito User Pool ID**:
   ```bash
   USER_POOL_ID=$(aws cloudformation describe-stacks \
     --stack-name lf-lh-nested-o-sp6-dev \
     --query 'Stacks[0].Outputs[?OutputKey==`CognitoUserPoolId`].OutputValue' \
     --output text)
   ```

2. **Create a developer user**:
   ```bash
   aws cognito-idp admin-create-user \
     --user-pool-id $USER_POOL_ID \
     --username dev-user@example.com \
     --user-attributes Name=email,Value=dev-user@example.com Name=email_verified,Value=true \
     --temporary-password "TempPassword123!" \
     --message-action SUPPRESS
   ```

3. **Set permanent password**:
   ```bash
   aws cognito-idp admin-set-user-password \
     --user-pool-id $USER_POOL_ID \
     --username dev-user@example.com \
     --password "Password123!" \
     --permanent
   ```

4. **Add user to Developers group**:
   ```bash
   aws cognito-idp admin-add-user-to-group \
     --user-pool-id $USER_POOL_ID \
     --username dev-user@example.com \
     --group-name Developers
   ```

5. **Create an admin user**:
   ```bash
   aws cognito-idp admin-create-user \
     --user-pool-id $USER_POOL_ID \
     --username admin@example.com \
     --user-attributes Name=email,Value=admin@example.com Name=email_verified,Value=true \
     --message-action SUPPRESS
   
   aws cognito-idp admin-set-user-password \
     --user-pool-id $USER_POOL_ID \
     --username admin@example.com \
     --password "AdminPassword123!" \
     --permanent
   
   aws cognito-idp admin-add-user-to-group \
     --user-pool-id $USER_POOL_ID \
     --username admin@example.com \
     --group-name Admins
   ```

### Retrieve Cognito Client Secret

The OAuth Lambda needs the Cognito App Client Secret. Store it in AWS Secrets Manager:

1. **Get client secret**:
   ```bash
   APP_CLIENT_ID=$(aws cloudformation describe-stacks \
     --stack-name lf-lh-nested-o-sp6-dev \
     --query 'Stacks[0].Outputs[?OutputKey==`CognitoAppClientId`].OutputValue' \
     --output text)
   
   CLIENT_SECRET=$(aws cognito-idp describe-user-pool-client \
     --user-pool-id $USER_POOL_ID \
     --client-id $APP_CLIENT_ID \
     --query 'UserPoolClient.ClientSecret' \
     --output text)
   ```

2. **Store in Secrets Manager**:
   ```bash
   aws secretsmanager create-secret \
     --name lf-cognito-client-secret-dev \
     --description "Cognito App Client Secret for OAuth Lambda" \
     --secret-string "{\"client_secret\":\"$CLIENT_SECRET\"}"
   ```

   Or update if it exists:
   ```bash
   aws secretsmanager update-secret \
     --secret-id lf-cognito-client-secret-dev \
     --secret-string "{\"client_secret\":\"$CLIENT_SECRET\"}"
   ```

## Testing

### Test OAuth Endpoint

```bash
# Get API endpoint
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name lf-lh-nested-o-sp6-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`APIEndpointOAuth`].OutputValue' \
  --output text)

# Test with developer user (limited permissions)
curl -X POST $API_ENDPOINT \
  -H "Content-Type: application/json" \
  -d '{
    "username": "dev-user@example.com",
    "password": "Password123!",
    "query": "SELECT * FROM \"lf-lh-silver-db-o-sp6-dev\".\"members\" LIMIT 5"
  }'
```

Expected response:
```json
{
  "success": true,
  "authenticatedUser": "dev-user@example.com",
  "userGroups": ["Developers"],
  "lfRole": "arn:aws:iam::123456789012:role/lf-lh-dev-user-role-o-sp6-dev",
  "query": "SELECT * FROM ...",
  "rowCount": 5,
  "data": [...]
}
```

### Test with Admin User

```bash
curl -X POST $API_ENDPOINT \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin@example.com",
    "password": "AdminPassword123!",
    "query": "SELECT * FROM \"lf-lh-silver-db-o-sp6-dev\".\"members\""
  }'
```

Admin users can access PII columns that developers cannot.

## User-to-Role Mapping

The Lambda function maps Cognito users to Lake Formation roles using this logic:

| Cognito Group | Lake Formation Role | Permissions |
|---------------|---------------------|-------------|
| Admins, SuperUsers, DataEngineers | LF Super User Role | Full access including PII columns |
| Developers, Analysts, DataScientists | LF Dev User Role | Limited access, no PII |
| None (default) | LF Dev User Role | Limited access |

You can also use custom attributes:
```bash
aws cognito-idp admin-update-user-attributes \
  --user-pool-id $USER_POOL_ID \
  --username user@example.com \
  --user-attributes Name=custom:lf_role,Value=super
```

## Security Considerations

### ✅ Secure
- Cognito validates credentials before issuing tokens
- JWT tokens are signed and validated
- Passwords never stored in Lambda
- Temporary credentials for assumed roles
- CloudTrail audit logs include authenticated username

### ⚠️ Client Secret Management
- Client secret stored in Secrets Manager
- Lambda retrieves secret at runtime via environment variable
- Rotate client secret periodically

### 🔒 Best Practices
- Use strong password policies (enforced by Cognito)
- Enable MFA for production users
- Rotate credentials regularly
- Monitor CloudWatch Logs for authentication failures
- Use HTTPS only (enforced by API Gateway)

## Troubleshooting

### Authentication Failures

Check CloudWatch Logs:
```bash
aws logs tail /aws/lambda/lf-oauth-query-handler-o-sp6-dev --follow
```

Common errors:
- `NotAuthorizedException`: Wrong password
- `UserNotFoundException`: User doesn't exist
- `Missing SECRET_HASH`: Client secret not configured correctly

### Lambda Can't Assume Role

Verify Lambda execution role has permissions:
```bash
aws iam get-role-policy \
  --role-name lf-oauth-query-lambda-role-o-sp6-dev \
  --policy-name OAuthCognitoAccess-dev
```

### Query Authorization Failures

Check Lake Formation permissions:
```bash
aws lakeformation list-permissions \
  --principal DataLakePrincipalIdentifier=arn:aws:iam::ACCOUNT:role/lf-lh-dev-user-role-o-sp6-dev
```

## Comparison to Other Authentication Methods

| Feature | API Key | Direct IAM | OAuth/Cognito |
|---------|---------|-----------|---------------|
| Client Complexity | ⭐ Simple | ⭐⭐ AWS SDK required | ⭐ Simple (HTTP only) |
| Individual User Tracking | ❌ No | ✅ Yes | ✅ Yes |
| Password-based Auth | ❌ No | ❌ No | ✅ Yes |
| MFA Support | ❌ No | ⚠️ Policy-based | ✅ Native |
| Token Expiry | ❌ Never | ⚠️ Long-lived | ✅ 1 hour |
| User Management | Manual | AWS IAM | Cognito (centralized) |
| Best For | External partners | AWS services | Internal employees |

## Architecture Diagram

See: `API_ACCESS_DESIGN_APPROACHES/oauth-proxy-sequence.drawio`

## Cost Estimate

- **Cognito**: First 50,000 MAUs free, then $0.0055/MAU
- **Lambda**: ~$0.20/million requests
- **API Gateway**: ~$3.50/million requests
- **Secrets Manager**: $0.40/secret/month

**Example**: 100 users making 1000 queries/month each = ~$2/month
