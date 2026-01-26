# OAuth 2.0 Implementation - Remaining Tasks

## ✅ Completed

1. **Infrastructure (CloudFormation)**
   - ✅ Cognito User Pool (`cognito-stack.yaml`)
   - ✅ OAuth Lambda Function definition (`lambda-stack.yaml`)
   - ✅ OAuth Lambda Role with proper permissions (`lambda-stack.yaml`)
   - ✅ API Gateway route `/query-oauth` (`api-stack.yaml`)
   - ✅ Main stack orchestration (`main.yaml`)
   - ✅ Cognito parameters passed to Lambda stack

2. **Application Code**
   - ✅ OAuth Lambda handler (`lambdas-oauth/index.py`)
   - ✅ Dependencies file (`lambdas-oauth/requirements.txt`)

3. **Build & Deploy Scripts**
   - ✅ Build script (`build-oauth-lambda.sh`)
   - ✅ Test script (`test-oauth.sh`)
   - ✅ Upload templates script (`upload-templates.sh`)

4. **Documentation**
   - ✅ OAuth Guide (`OAUTH_GUIDE.md`)
   - ✅ API Guide (`API_GUIDE.md`)
   - ✅ Multi-environment Guide (`MULTI_ENV_GUIDE.md`)

## 🔄 Remaining Tasks

### 1. Store Cognito Client Secret in AWS Secrets Manager

The OAuth Lambda needs the Cognito App Client Secret, which must be stored securely:

```bash
# After deploying Cognito stack, get the client secret
CLIENT_SECRET=$(aws cognito-idp describe-user-pool-client \
  --user-pool-id <USER_POOL_ID> \
  --client-id <APP_CLIENT_ID> \
  --query 'UserPoolClient.ClientSecret' \
  --output text)

# Store in Secrets Manager
aws secretsmanager create-secret \
  --name lf-cognito-client-secret-dev \
  --description "Cognito App Client Secret for OAuth Lambda" \
  --secret-string "{\"client_secret\":\"$CLIENT_SECRET\"}" \
  --region us-east-1
```

**Why**: The Lambda function references this in environment variables:
```yaml
COGNITO_CLIENT_SECRET: !Sub '{{resolve:secretsmanager:lf-cognito-client-secret-${Environment}:SecretString:client_secret}}'
```

### 2. Build and Upload Lambda Deployment Package

```bash
cd lf-lh-gov-nested

# Build OAuth Lambda
./build-oauth-lambda.sh

# Upload to S3
aws s3 cp build/oauth-query-handler.zip s3://deploymen-bkt/lambda/
```

### 3. Upload CloudFormation Templates

```bash
# Upload all templates to S3
./upload-templates.sh deploymen-bkt lf-nested-stacks us-east-1
```

### 4. Deploy Stack with OAuth Enabled

```bash
aws cloudformation deploy \
  --template-file main.yaml \
  --stack-name lf-master-stack-o-sp6-dev \
  --parameter-overrides \
    Environment=dev \
    EnableOAuth=true \
    TemplateS3Bucket=deploymen-bkt \
    TemplateS3Prefix=lf-nested-stacks \
    LambdaCodeS3Bucket=deploymen-bkt \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1
```

### 5. Create Cognito Users

```bash
# Create a developer user
aws cognito-idp admin-create-user \
  --user-pool-id <USER_POOL_ID> \
  --username dev-user@example.com \
  --user-attributes \
    Name=email,Value=dev-user@example.com \
    Name=email_verified,Value=true \
  --temporary-password "TempPassword123!" \
  --region us-east-1

# Add user to Developers group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id <USER_POOL_ID> \
  --username dev-user@example.com \
  --group-name Developers \
  --region us-east-1

# Create an admin user
aws cognito-idp admin-create-user \
  --user-pool-id <USER_POOL_ID> \
  --username admin-user@example.com \
  --user-attributes \
    Name=email,Value=admin-user@example.com \
    Name=email_verified,Value=true \
  --temporary-password "TempPassword123!" \
  --region us-east-1

# Add user to Admins group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id <USER_POOL_ID> \
  --username admin-user@example.com \
  --group-name Admins \
  --region us-east-1
```

### 6. Test OAuth Authentication

```bash
# Test with Cognito credentials
./test-oauth.sh dev us-east-1

# You'll be prompted for:
# - Username (email)
# - Password
```

### 7. Verify Lambda Function Code

The OAuth Lambda (`lambdas-oauth/index.py`) already implements:
- ✅ Cognito authentication (USER_PASSWORD_AUTH flow)
- ✅ Token caching for warm Lambda invocations
- ✅ User group → Lake Formation role mapping
- ✅ AssumeRole for Lake Formation permissions
- ✅ Athena query execution

**Group to Role Mapping** (in code):
```python
def get_lf_role_for_user(cognito_groups):
    if 'Admins' in cognito_groups:
        return LF_SUPER_ROLE_ARN
    else:  # Developers, Analysts, DataScientists
        return LF_DEV_ROLE_ARN
```

## 🔍 Testing Checklist

After deployment:

- [ ] Cognito User Pool created
- [ ] Cognito App Client has secret stored in Secrets Manager
- [ ] OAuth Lambda function deployed successfully
- [ ] API Gateway `/query-oauth` endpoint accessible
- [ ] Dev user can authenticate and query non-PII data
- [ ] Dev user cannot access PII-tagged columns
- [ ] Admin user can authenticate and query all data including PII
- [ ] Invalid credentials are rejected with 401
- [ ] CloudWatch logs show authentication flow

## 📊 Architecture Verification

After deployment, verify the complete flow:

1. **Client Request** → API Gateway `/query-oauth`
2. **Lambda** → Cognito InitiateAuth (validates credentials)
3. **Cognito** → Returns JWT tokens
4. **Lambda** → Validates JWT signature
5. **Lambda** → Extracts user groups from Cognito
6. **Lambda** → Maps groups to LF role ARN
7. **Lambda** → STS AssumeRole (LF role)
8. **Lambda** → Athena query execution (with LF permissions)
9. **Lambda** → Returns results to client

## 📝 Notes

### Differences from Standard OAuth 2.0

This implementation uses the **OAuth Proxy Pattern**:
- Client sends credentials in request body (not standard OAuth flow)
- Lambda handles token exchange (not client)
- Simpler for clients (no OAuth library needed)
- Best for background jobs and scripts

### Security Considerations

- ✅ Credentials transmitted over HTTPS (API Gateway enforces TLS)
- ✅ Client secret stored in Secrets Manager (not environment variables)
- ✅ Tokens cached in Lambda memory (reduces Cognito calls)
- ✅ Lake Formation enforces column-level access control
- ✅ CloudWatch logs capture authentication events

### Cost Optimization

- Token caching reduces Cognito API calls (saved $)
- Cognito User Pool pricing: First 50,000 MAUs free
- After that: $0.0055 per MAU (Monthly Active Users)

## 🚀 Quick Start Commands

```bash
# Full deployment sequence
cd lf-lh-gov-nested

# 1. Build Lambda
./build-oauth-lambda.sh

# 2. Upload Lambda to S3
aws s3 cp build/oauth-query-handler.zip s3://deploymen-bkt/lambda/

# 3. Upload templates
./upload-templates.sh deploymen-bkt lf-nested-stacks us-east-1

# 4. Deploy with OAuth enabled
aws cloudformation deploy \
  --template-file main.yaml \
  --stack-name lf-master-stack-o-sp6-dev \
  --parameter-overrides EnableOAuth=true \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1

# 5. Get stack outputs
aws cloudformation describe-stacks \
  --stack-name lf-master-stack-o-sp6-dev \
  --query 'Stacks[0].Outputs' \
  --output table

# 6. Store client secret (get from outputs)
# See "Store Cognito Client Secret" section above

# 7. Create users (see section above)

# 8. Test
./test-oauth.sh dev us-east-1
```

## ❓ Troubleshooting

### Issue: Lambda can't resolve Secrets Manager

**Error**: `ClientError: Secrets Manager can't find the specified secret`

**Solution**: Ensure secret name matches environment:
```bash
aws secretsmanager list-secrets --region us-east-1 | grep lf-cognito
```

### Issue: Cognito authentication fails

**Error**: `NotAuthorizedException: Incorrect username or password`

**Solutions**:
1. Verify user exists in Cognito
2. Check if user needs to change temporary password
3. Verify user has confirmed email

### Issue: No permission to query table

**Error**: `AccessDeniedException: Insufficient Lake Formation permission`

**Solutions**:
1. Verify user is in correct Cognito group
2. Check Lake Formation permissions for the role
3. Verify tag associations on database/table/columns
4. Check that IAMAllowedPrincipals has been revoked

## 📚 References

- [AWS Cognito User Pools](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-identity-pools.html)
- [Lake Formation Tag-Based Access Control](https://docs.aws.amazon.com/lake-formation/latest/dg/tag-based-access-control.html)
- [OAuth 2.0 RFC](https://datatracker.ietf.org/doc/html/rfc6749)
- [OAUTH_GUIDE.md](./OAUTH_GUIDE.md) - Detailed implementation guide
