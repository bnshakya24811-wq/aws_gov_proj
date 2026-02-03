# OAuth Client Credentials Flow

This stack implements OAuth 2.0 Client Credentials Grant for machine-to-machine authentication with Lake Formation access control.

## Architecture

```
Service/Script
  ↓ [client_id + client_secret]
Cognito Token Endpoint
  ↓ [returns access_token with scopes]
API Gateway (/query-client-creds)
  ↓ [Bearer token]
Lambda
  ├→ Validates JWT token
  ├→ Extracts client_id & scopes
  ├→ Maps client_id → LF Role (or scope → LF Role)
  ├→ Assumes LF Role
  └→ Executes Athena query
Lake Formation enforces permissions
```

## Components

### 1. Cognito Stack
- **User Pool**: Manages OAuth clients (no human users)
- **Resource Server**: Defines scopes (`query.read`, `query.write`, `query.admin`)
- **App Clients**:
  - `etl-service-client` - Write access (admin scope)
  - `reporting-service-client` - Read-only
  - `monitoring-service-client` - Read-only

### 2. Lambda Stack
- Validates Bearer tokens (JWT)
- Maps `client_id` or `scope` to IAM roles
- Assumes Lake Formation role
- Executes Athena queries

### 3. API Stack
- `/query-client-creds` endpoint
- No API key required (Bearer token in Authorization header)

## Deployment

### Prerequisites
1. Existing IAM stack with LF roles deployed
2. Glue database created
3. S3 bucket for templates

### Deploy
```bash
chmod +x deploy.sh
./deploy.sh dev deploymen-bkt ap-southeast-2
```

### Post-Deployment: Update Client Secrets
```bash
# Get client secret from Cognito
CLIENT_SECRET=$(aws cognito-idp describe-user-pool-client \
  --user-pool-id <USER_POOL_ID> \
  --client-id <CLIENT_ID> \
  --query 'UserPoolClient.ClientSecret' --output text)

# Update in Secrets Manager
aws secretsmanager update-secret \
  --secret-id lf-etl-client-secret-dev \
  --secret-string "{\"client_id\":\"<CLIENT_ID>\",\"client_secret\":\"$CLIENT_SECRET\"}"
```

## Usage

### 1. Get Access Token
```bash
curl -X POST https://lf-client-creds-dev-123456789012.auth.us-east-1.amazoncognito.com/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "CLIENT_ID:CLIENT_SECRET" \
  -d "grant_type=client_credentials&scope=athena-api/query.read athena-api/query.write"

# Response:
{
  "access_token": "eyJraWQi...",
  "expires_in": 3600,
  "token_type": "Bearer"
}
```

### 2. Execute Query
```bash
curl -X POST https://abc123.execute-api.us-east-1.amazonaws.com/dev/query-client-creds \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJraWQi..." \
  -d '{
    "query": "SELECT * FROM members LIMIT 10"
  }'

# Response:
{
  "success": true,
  "authMethod": "CLIENT_CREDENTIALS",
  "clientId": "5abc123def456",
  "scopes": ["athena-api/query.read", "athena-api/query.write"],
  "lfRole": "arn:aws:iam::123456789012:role/lf-super-user-role",
  "rowCount": 10,
  "data": [...]
}
```

## Client to Role Mapping

### Hardcoded Mapping (in Lambda)
```python
CLIENT_ROLE_MAPPING = {
    'etl-service': LF_SUPER_ROLE_ARN,      # Full access
    'reporting-service': LF_DEV_ROLE_ARN,   # Read-only
    'monitoring-service': LF_DEV_ROLE_ARN   # Read-only
}
```

### Scope-Based Mapping (Fallback)
```python
SCOPE_ROLE_MAPPING = {
    'athena-api/query.admin': LF_SUPER_ROLE_ARN,
    'athena-api/query.write': LF_SUPER_ROLE_ARN,
    'athena-api/query.read': LF_DEV_ROLE_ARN
}
```

**Priority**: Client ID mapping → Scope mapping → Deny

## Testing

```bash
chmod +x test-client-creds.sh
./test-client-creds.sh dev
```

Tests:
1. ✅ ETL client gets token with write scope
2. ✅ ETL client executes query (maps to super role)
3. ✅ Reporting client gets token with read scope
4. ✅ Reporting client executes query (maps to dev role)
5. ✅ Invalid token rejected

## Differences from OAuth Proxy Pattern

| Aspect | OAuth Proxy | Client Credentials |
|--------|-------------|-------------------|
| **Authentication** | Username + Password | Client ID + Secret |
| **Identity** | Human users | Services/Applications |
| **Groups** | Cognito groups | OAuth scopes |
| **Token in request** | No (credentials in body) | Yes (Bearer token) |
| **Calls needed** | 1 (Lambda gets token) | 2 (get token, then query) |
| **Token caching** | No (stateless) | Yes (client can cache) |
| **Best for** | Interactive users | Scheduled scripts, services |

## Security Notes

1. **Client Secrets**: Store in AWS Secrets Manager, rotate regularly
2. **Token Validation**: Lambda validates JWT signature and expiration
3. **Scope Enforcement**: Only granted scopes can be used
4. **Audit**: CloudWatch logs show client_id for all queries
5. **Token Lifetime**: 1 hour (configurable in Cognito)

## Troubleshooting

### Token endpoint returns error
- Check client_id and client_secret are correct
- Verify client has `client_credentials` flow enabled
- Check requested scopes are allowed for the client

### Lambda returns 401
- Token may be expired
- Token issuer doesn't match User Pool
- Token signature invalid

### Lambda returns 403
- Client ID not in mapping and no valid scope
- Update `CLIENT_ROLE_MAPPING` in Lambda code

### Query fails with LF permissions error
- Check client is mapped to correct LF role
- Verify LF role has required permissions
- Check Lake Formation tags are applied

## Files

```
oauth-client-flow/
├── main-client-creds.yaml              # Main nested stack
├── cognito-client-creds-stack.yaml     # Cognito + clients
├── lambda-client-creds-stack.yaml      # Lambda validator
├── api-client-creds-stack.yaml         # API Gateway
├── lambda/
│   └── index.py                        # Token validator & query executor
├── deploy.sh                           # Deployment script
├── test-client-creds.sh                # Test script
└── README.md                           # This file
```

## Next Steps

1. Deploy stack: `./deploy.sh dev`
2. Update client secrets in Secrets Manager
3. Test: `./test-client-creds.sh dev`
4. Integrate with your services/scripts
5. Monitor CloudWatch logs for audit trail
