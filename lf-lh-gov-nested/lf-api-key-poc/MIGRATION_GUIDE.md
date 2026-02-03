# Migration Guide: Direct API Keys → Secrets Manager

This guide helps you migrate from the old approach (API keys in DynamoDB) to the new approach (API keys in Secrets Manager).

## What Changed

### Before (Old Approach)
```yaml
# DynamoDB Table
APIKeyMappingTable:
  AttributeDefinitions:
    - AttributeName: apiKey        # ❌ Plain API key
      AttributeType: S
  KeySchema:
    - AttributeName: apiKey
      KeyType: HASH

# Lambda reads API key directly from DynamoDB
GetCommand({
  TableName: 'lf-apikey-mappings',
  Key: { apiKey: 'abc123xyz' }      # ❌ Direct lookup
})
```

### After (New Approach)
```yaml
# Secrets Manager Secret
DevUserAPIKeySecret:
  Type: AWS::SecretsManager::Secret
  SecretString: |
    {
      "apiKey": "abc123xyz",       # ✓ Encrypted
      "userName": "dev-user",
      "permissions": "read-only"
    }

# DynamoDB Table
APIKeyMappingTable:
  AttributeDefinitions:
    - AttributeName: secretId       # ✓ Secret ARN, not plain key
      AttributeType: S

# Lambda scans DynamoDB for secrets, then validates via Secrets Manager
ScanCommand({ TableName: 'lf-apikey-mappings' })
GetSecretValueCommand({ SecretId: 'arn:...' })
```

## Migration Steps

### Step 1: Backup Existing Data

Before migrating, export your current API key mappings:

```bash
aws dynamodb scan \
  --table-name lf-apikey-mappings-apk-dev \
  --region us-east-1 \
  > backup-api-keys-$(date +%Y%m%d).json
```

### Step 2: Update Lambda Code

The Lambda code has been updated to use the new `ApiKeyService`. You need to:

1. **Install new dependency**:
   ```bash
   cd lambdas-ts-apikey
   npm install @aws-sdk/client-secrets-manager@^3.515.0
   ```

2. **Rebuild Lambda package**:
   ```bash
   npm run build
   cd dist
   zip -r ../athena-query-apikey-dev.zip .
   ```

3. **Upload to S3**:
   ```bash
   aws s3 cp athena-query-apikey-dev.zip \
     s3://your-lambda-bucket/lambda/api-key-poc/athena-query-apikey-dev.zip
   ```

### Step 3: Update CloudFormation Stack

The `lambda-apikey-stack.yaml` template has been updated with:
- Secrets Manager resources
- Updated DynamoDB schema (secretId instead of apiKey)
- Updated Lambda IAM permissions
- Custom resource to populate initial mappings

**Option A: Update Existing Stack** (Recommended for development)

```bash
# Upload updated template
aws s3 cp lambda-apikey-stack.yaml s3://lf-lh-nest-sts/lf-api-key/

# Update the stack
aws cloudformation update-stack \
  --stack-name lf-apikey-poc-dev \
  --template-body file://main-apikey.yaml \
  --parameters \
    ParameterKey=Environment,ParameterValue=dev \
    ParameterKey=DatabaseName,UsePreviousValue=true \
    ParameterKey=LambdaArtifactsBucket,UsePreviousValue=true \
    ParameterKey=LambdaCodeS3Key,UsePreviousValue=true \
    ParameterKey=DevUserAPIKeyId,ParameterValue=your-dev-api-key \
    ParameterKey=SuperUserAPIKeyId,ParameterValue=your-super-api-key \
    ParameterKey=AthenaBucketName,UsePreviousValue=true \
    ParameterKey=AthenaOutputPrefix,UsePreviousValue=true \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1
```

**⚠️ Note**: CloudFormation will try to delete the old DynamoDB table and create a new one. If you have data you need to preserve, use Option B.

**Option B: Create New Stack with Different Name** (Recommended for production)

```bash
# Deploy alongside existing stack
aws cloudformation create-stack \
  --stack-name lf-apikey-poc-v2-dev \
  --template-body file://main-apikey.yaml \
  --parameters \
    ParameterKey=Environment,ParameterValue=dev \
    ParameterKey=DatabaseName,ParameterValue=lf-lh-silver-db-o-sp \
    ParameterKey=LambdaArtifactsBucket,ParameterValue=your-lambda-bucket \
    ParameterKey=LambdaCodeS3Key,ParameterValue=lambda/api-key-poc/athena-query-apikey-dev.zip \
    ParameterKey=DevUserAPIKeyId,ParameterValue=your-dev-api-key \
    ParameterKey=SuperUserAPIKeyId,ParameterValue=your-super-api-key \
    ParameterKey=AthenaBucketName,ParameterValue=aws-athena-query-results-123-us-east-1 \
    ParameterKey=AthenaOutputPrefix,ParameterValue=api-key-poc/ \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1

# Test the new stack
# Once verified, delete the old stack
```

### Step 4: Migrate Existing API Keys

If you had custom API keys in the old system, migrate them using the helper script:

```bash
# Extract old API keys from backup
cat backup-api-keys-*.json | jq -r '.Items[] | 
  [.apiKey.S, .roleArn.S, .userName.S, .permissions.S] | @tsv' | \
while IFS=$'\t' read -r apiKey roleArn userName permissions; do
  echo "Migrating: $userName"
  
  python create-api-key.py \
    --user-name "$userName" \
    --role-arn "$roleArn" \
    --permissions "$permissions" \
    --api-key "$apiKey" \
    --environment dev \
    --region us-east-1
done
```

**Important**: The `DevUserAPIKeyId` and `SuperUserAPIKeyId` parameters are automatically created during stack deployment, so you only need to migrate additional custom keys.

### Step 5: Update API Clients

The API interface hasn't changed! Clients still use the same x-api-key header:

```bash
curl -X POST https://your-api-url/query \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"tableName": "members", "limit": 10}'
```

No changes needed for API consumers.

### Step 6: Verify Migration

Test both old API keys (if kept) and new API keys:

```bash
# Test dev user key
curl -X POST https://your-api-url/query \
  -H "x-api-key: $DEV_API_KEY" \
  -d '{"tableName": "members", "limit": 5}'

# Test super user key  
curl -X POST https://your-api-url/query \
  -H "x-api-key: $SUPER_API_KEY" \
  -d '{"tableName": "members", "limit": 5}'

# Test invalid key (should return 403)
curl -X POST https://your-api-url/query \
  -H "x-api-key: invalid-key" \
  -d '{"tableName": "members"}'
```

### Step 7: Monitor CloudWatch Logs

Watch the Lambda logs to ensure API key validation is working:

```bash
aws logs tail /aws/lambda/lf-athena-apikey-handler-apk-dev --follow
```

Look for log messages like:
- ✅ "Validating API key"
- ✅ "Found 2 secret mappings"
- ✅ "API key validated successfully"
- ❌ "API key not found in any secret"

### Step 8: Clean Up Old Resources (Optional)

Once you've verified the new stack works:

```bash
# Delete old stack if you created a new one
aws cloudformation delete-stack \
  --stack-name lf-apikey-poc-dev \
  --region us-east-1

# Delete backup file (keep it for audit purposes)
# rm backup-api-keys-*.json
```

## Rollback Plan

If you need to rollback:

### If you updated existing stack:
```bash
# CloudFormation doesn't support easy rollback to old schema
# You'll need to redeploy the old template

aws cloudformation update-stack \
  --stack-name lf-apikey-poc-dev \
  --template-body file://lambda-apikey-stack-OLD.yaml \
  --parameters ... \
  --capabilities CAPABILITY_NAMED_IAM
```

### If you created new stack:
```bash
# Simply switch API Gateway to point to old Lambda
# Or delete new stack and keep using old one

aws cloudformation delete-stack --stack-name lf-apikey-poc-v2-dev
```

## Troubleshooting

### "No API key mappings configured"

The custom resource failed to populate DynamoDB. Check:

```bash
# Check if custom resource Lambda succeeded
aws cloudformation describe-stack-events \
  --stack-name lf-apikey-poc-dev \
  --max-items 20 | \
  jq '.StackEvents[] | select(.ResourceType=="Custom::InitMappings")'

# Check custom resource Lambda logs
aws logs tail /aws/lambda/lf-init-mappings-apk-dev --follow
```

### "Invalid API key" but key should be valid

1. Verify secret exists:
   ```bash
   aws secretsmanager describe-secret \
     --secret-id lf-apikey-dev-user-apk-dev
   ```

2. Verify secret value:
   ```bash
   aws secretsmanager get-secret-value \
     --secret-id lf-apikey-dev-user-apk-dev \
     --query SecretString --output text | jq
   ```

3. Verify DynamoDB mapping:
   ```bash
   aws dynamodb scan --table-name lf-apikey-mappings-apk-dev
   ```

4. Check Lambda has permission to read secret:
   ```bash
   aws iam get-role-policy \
     --role-name lf-athena-apikey-lambda-role-apk-dev \
     --policy-name ApiKeyLambdaPolicy-apk-dev
   ```

### Stack update fails with "Resource already exists"

If updating from old schema to new:

1. Change table name in template temporarily
2. Update stack (creates new table)
3. Migrate data manually
4. Change table name back
5. Update stack again (deletes old table)

## Key Differences Summary

| Aspect | Old Approach | New Approach |
|--------|-------------|--------------|
| **API Key Storage** | DynamoDB plain text | Secrets Manager encrypted |
| **DynamoDB Schema** | `apiKey` → `roleArn` | `secretId` → `roleArn` |
| **Lambda Lookup** | GetItem by apiKey | Scan + GetSecretValue |
| **IAM Permissions** | `dynamodb:GetItem` | `dynamodb:Scan`<br>`secretsmanager:GetSecretValue` |
| **CloudTrail Audit** | Limited | Full audit trail |
| **Key Rotation** | Manual | Automated support |
| **Encryption** | None | AWS KMS |
| **Cost** | ~$1/month | ~$3/month |
| **Performance** | ~50ms | ~100ms |

## Next Steps After Migration

1. ✅ Set up CloudWatch alarms for invalid API key attempts
2. ✅ Implement API key rotation schedule
3. ✅ Document API keys in your secrets management system
4. ✅ Train team on using `create-api-key.py` script
5. ✅ Set up automated backups of Secrets Manager
6. ✅ Review IAM permissions for least privilege

## Questions?

See [README_SECRETS.md](README_SECRETS.md) for full documentation on the new approach.
