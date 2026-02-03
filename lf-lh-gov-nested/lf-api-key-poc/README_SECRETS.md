# API Key POC - Secrets Manager Integration

This solution demonstrates secure API key management for Lake Formation access control using AWS Secrets Manager and DynamoDB.

## Architecture

### Security Flow

```
API Request (with x-api-key header)
  ↓
Lambda receives API key
  ↓
Lambda scans DynamoDB for all secret IDs
  ↓
For each secret ID:
  - Retrieve secret from Secrets Manager
  - Compare API key from secret with provided key
  ↓
If match found:
  - Get associated role ARN from DynamoDB
  - Assume the role
  - Execute Athena query with Lake Formation permissions
```

### Components

1. **Secrets Manager**: Stores actual API keys as JSON secrets
   - Each secret contains: `apiKey`, `userName`, `permissions`
   - Secrets are encrypted at rest

2. **DynamoDB**: Maps secret IDs to IAM role ARNs
   - Schema: `secretId` (partition key) → `roleArn`, `userName`, `permissions`
   - No plain API keys stored

3. **Lambda Function**: Validates API keys and executes queries
   - Retrieves secrets from Secrets Manager
   - Validates incoming API key
   - Assumes appropriate role based on mapping
   - Executes Athena query with Lake Formation permissions

## Deployment

### Prerequisites

- AWS CLI configured
- S3 bucket for CloudFormation templates: `lf-lh-nest-sts`
- S3 bucket for Lambda code: your Lambda artifacts bucket
- Two IAM roles created for Lake Formation access

### Step 1: Build Lambda Package

```bash
cd /path/to/lambdas-ts-apikey
npm install
npm run build
cd dist
zip -r ../athena-query-apikey-dev.zip .
```

### Step 2: Upload Lambda to S3

```bash
aws s3 cp athena-query-apikey-dev.zip s3://your-lambda-bucket/lambda/api-key-poc/athena-query-apikey-dev.zip
```

### Step 3: Upload Templates to S3

```bash
# From lf-api-key-poc directory
aws s3 cp iam-apikey-stack.yaml s3://lf-lh-nest-sts/lf-api-key/
aws s3 cp lambda-apikey-stack.yaml s3://lf-lh-nest-sts/lf-api-key/
aws s3 cp api-apikey-stack.yaml s3://lf-lh-nest-sts/lf-api-key/
aws s3 cp bucket-apikey-stack.yaml s3://lf-lh-nest-sts/lf-api-key/
aws s3 cp governance-apikey-stack.yaml s3://lf-lh-nest-sts/lf-api-key/
```

### Step 4: Deploy Main Stack

```bash
aws cloudformation create-stack \
  --stack-name lf-apikey-poc-dev \
  --template-body file://main-apikey.yaml \
  --parameters \
    ParameterKey=Environment,ParameterValue=dev \
    ParameterKey=DatabaseName,ParameterValue=lf-lh-silver-db-o-sp \
    ParameterKey=LambdaArtifactsBucket,ParameterValue=your-lambda-bucket \
    ParameterKey=LambdaCodeS3Key,ParameterValue=lambda/api-key-poc/athena-query-apikey-dev.zip \
    ParameterKey=DevUserAPIKeyId,ParameterValue=temp-dev-key \
    ParameterKey=SuperUserAPIKeyId,ParameterValue=temp-super-key \
    ParameterKey=AthenaBucketName,ParameterValue=aws-athena-query-results-123456789-us-east-1 \
    ParameterKey=AthenaOutputPrefix,ParameterValue=api-key-poc/ \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1
```

## Managing API Keys

### Create a New API Key

Use the helper script to create new API keys:

```bash
python create-api-key.py \
  --user-name analyst-user \
  --role-arn arn:aws:iam::123456789:role/lf-analyst-role \
  --permissions read-only \
  --environment dev \
  --region us-east-1
```

This will:
1. Generate a secure random API key (or use `--api-key` to provide your own)
2. Store it in Secrets Manager as `lf-apikey-analyst-user-apk-dev`
3. Create DynamoDB mapping: `secretARN` → `roleARN`
4. Display the API key for use

### Update an Existing API Key

To rotate an API key:

```bash
python create-api-key.py \
  --user-name dev-user \
  --role-arn arn:aws:iam::123456789:role/lf-dev-role \
  --api-key new-rotated-key-xyz \
  --environment dev \
  --region us-east-1
```

### List All API Keys

Query DynamoDB to see all mappings:

```bash
aws dynamodb scan \
  --table-name lf-apikey-mappings-apk-dev \
  --region us-east-1
```

### Revoke an API Key

Delete both the secret and the DynamoDB mapping:

```bash
# Delete from Secrets Manager
aws secretsmanager delete-secret \
  --secret-id lf-apikey-analyst-user-apk-dev \
  --force-delete-without-recovery \
  --region us-east-1

# Delete from DynamoDB (use the secret ARN as key)
aws dynamodb delete-item \
  --table-name lf-apikey-mappings-apk-dev \
  --key '{"secretId":{"S":"arn:aws:secretsmanager:us-east-1:123456789:secret:lf-apikey-analyst-user-apk-dev-AbCdEf"}}' \
  --region us-east-1
```

## Testing

### Using the API Key

Once deployed and an API Gateway is configured:

```bash
# Query a specific table
curl -X POST https://your-api-gateway-url/query \
  -H "x-api-key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "tableName": "members",
    "limit": 10
  }'

# Execute custom query
curl -X POST https://your-api-gateway-url/query \
  -H "x-api-key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "database": "lf-lh-silver-db-o-sp",
    "query": "SELECT name, email FROM members LIMIT 5"
  }'
```

### Verify Secrets Manager

```bash
# View secret metadata
aws secretsmanager describe-secret \
  --secret-id lf-apikey-dev-user-apk-dev \
  --region us-east-1

# Retrieve secret value (be careful with this!)
aws secretsmanager get-secret-value \
  --secret-id lf-apikey-dev-user-apk-dev \
  --region us-east-1 \
  --query SecretString \
  --output text | jq
```

## Security Considerations

### Why This Approach?

**Before**: API keys stored directly in DynamoDB
- Risk: Anyone with DynamoDB read access can see all API keys
- No encryption at rest for keys
- No audit trail for key access

**After**: API keys in Secrets Manager
- ✓ Encrypted at rest by default
- ✓ Automatic key rotation support
- ✓ Fine-grained access control
- ✓ CloudTrail logging of all secret access
- ✓ Versioning support for key rotation

### IAM Permissions Required

Lambda needs:
- `secretsmanager:GetSecretValue` on specific secrets
- `dynamodb:Scan` and `dynamodb:GetItem` on mapping table
- `sts:AssumeRole` on Lake Formation roles

### Best Practices

1. **Rotate API keys regularly**: Use the creation script with new keys
2. **Use separate secrets per user/application**: Don't share API keys
3. **Monitor secret access**: Set up CloudWatch alarms for `GetSecretValue` calls
4. **Restrict secret access**: Only Lambda should have `GetSecretValue` permission
5. **Use secret versioning**: Secrets Manager tracks all changes

## Troubleshooting

### "Invalid API key" Error

1. Verify the API key exists in Secrets Manager
2. Check DynamoDB mapping exists for that secret
3. Ensure Lambda has permission to read the secret

### "Failed to validate API key" Error

Check Lambda CloudWatch logs for specific error:

```bash
aws logs tail /aws/lambda/lf-athena-apikey-handler-apk-dev --follow
```

### Secret Not Found

Verify secret name follows the pattern: `lf-apikey-{user-name}-apk-{environment}`

## Architecture Diagram

```
┌─────────────────┐
│   API Client    │
│ (x-api-key: xxx)│
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│  API Gateway    │
│   (Optional)    │
└────────┬────────┘
         │
         ↓
┌─────────────────┐      ┌──────────────────┐
│  Lambda         │─────→│ Secrets Manager  │
│  Function       │      │ • API Keys       │
└────────┬────────┘      │ • Encrypted      │
         │               └──────────────────┘
         ↓
┌─────────────────┐
│   DynamoDB      │
│ secretId→roleArn│
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│      STS        │
│  (AssumeRole)   │
└────────┬────────┘
         │
         ↓
┌─────────────────┐
│     Athena      │
│ + Lake Formation│
└─────────────────┘
```

## File Structure

```
lf-api-key-poc/
├── main-apikey.yaml              # Root stack
├── iam-apikey-stack.yaml         # IAM roles for Lake Formation
├── lambda-apikey-stack.yaml      # Lambda, DynamoDB, Secrets Manager
├── api-apikey-stack.yaml         # API Gateway (optional)
├── bucket-apikey-stack.yaml      # S3 buckets
├── governance-apikey-stack.yaml  # Lake Formation tags/permissions
├── create-api-key.py             # Helper script for API key management
└── README_SECRETS.md             # This file
```

## Cost Considerations

- **Secrets Manager**: $0.40/secret/month + $0.05 per 10,000 API calls
- **DynamoDB**: Pay-per-request (minimal for this use case)
- **Lambda**: Free tier covers most development usage
- **CloudWatch Logs**: Minimal storage costs

For 10 API keys with 10,000 requests/day:
- Secrets Manager: ~$4.40/month
- DynamoDB: <$1/month
- Total: ~$5-6/month

## Next Steps

1. Integrate with API Gateway for REST API
2. Add API key usage metrics
3. Implement automatic key rotation
4. Add webhook for key expiration notifications
5. Create IAM policy generator for new roles
