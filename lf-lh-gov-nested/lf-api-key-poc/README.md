# Lake Formation API Key Access Control POC

This POC demonstrates how to enforce Lake Formation tag-based access control (TBAC) through API Gateway using API keys. Each API key is mapped to a specific IAM role with different Lake Formation permissions.

## Architecture

```
Client Request (with x-api-key header)
         ↓
   API Gateway (/query endpoint)
         ↓
   Lambda Function
         ↓
   DynamoDB Lookup (API Key → IAM Role ARN)
         ↓
   AssumeRole (with Lake Formation role)
         ↓
   Athena Query (with assumed credentials)
         ↓
   Return Results
```

## Components

### 1. IAM Stack (`iam-apikey-stack.yaml`)
- **LFDevUserRole**: Limited Lake Formation permissions
- **LFSuperUserRole**: Full Lake Formation permissions

Both roles are assumable only by the Lambda function.

### 2. Lambda Stack (`lambda-apikey-stack.yaml`)
- **DynamoDB Table**: Stores API key → IAM role ARN mappings
- **Lambda Function**: 
  - Validates API key
  - Looks up corresponding IAM role
  - Assumes the role
  - Executes Athena query with assumed credentials

### 3. API Stack (`api-apikey-stack.yaml`)
- **API Gateway REST API**: `/query` endpoint
- **Two API Keys**:
  - Dev User API Key → mapped to LFDevUserRole
  - Super User API Key → mapped to LFSuperUserRole
- **Custom Resource**: Populates DynamoDB with API key mappings

## Deployment

### Prerequisites
- Existing Glue database with tables
- Lambda deployment package uploaded to S3

### Deploy

```bash
aws cloudformation create-stack \
  --stack-name lf-apikey-poc-dev \
  --template-body file://main-apikey.yaml \
  --parameters \
    ParameterKey=Environment,ParameterValue=dev \
    ParameterKey=DatabaseName,ParameterValue=YOUR_DATABASE_NAME \
    ParameterKey=LambdaCodeS3Bucket,ParameterValue=YOUR_BUCKET \
    ParameterKey=LambdaCodeS3Key,ParameterValue=lambda/athena-query-apikey-dev.zip \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1
```

### Get API Keys

```bash
# Get stack outputs
STACK_NAME=lf-apikey-poc-dev

# Get API key IDs
DEV_KEY_ID=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query 'Stacks[0].Outputs[?OutputKey==`DevUserAPIKeyId`].OutputValue' \
  --output text)

SUPER_KEY_ID=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query 'Stacks[0].Outputs[?OutputKey==`SuperUserAPIKeyId`].OutputValue' \
  --output text)

# Get actual API key values
DEV_KEY=$(aws apigateway get-api-key \
  --api-key $DEV_KEY_ID \
  --include-value \
  --query 'value' \
  --output text)

SUPER_KEY=$(aws apigateway get-api-key \
  --api-key $SUPER_KEY_ID \
  --include-value \
  --query 'value' \
  --output text)

echo "Dev User API Key: $DEV_KEY"
echo "Super User API Key: $SUPER_KEY"
```

## Testing

### Test with Dev User (Limited Permissions)

```bash
ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name lf-apikey-poc-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`APIEndpoint`].OutputValue' \
  --output text)

curl -X POST $ENDPOINT \
  -H "x-api-key: $DEV_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tableName": "your_table_name",
    "limit": 5
  }'
```

### Test with Super User (Full Permissions)

```bash
curl -X POST $ENDPOINT \
  -H "x-api-key: $SUPER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tableName": "your_table_name",
    "limit": 10
  }'
```

## Request Format

```json
{
  "tableName": "table_name",
  "limit": 100
}
```

## Response Format

**Success:**
```json
{
  "success": true,
  "query": "SELECT * FROM \"database\".\"table\" LIMIT 5",
  "rowCount": 5,
  "data": [
    ["column1", "column2", "column3"],
    ["value1", "value2", "value3"],
    ...
  ]
}
```

**Error:**
```json
{
  "success": false,
  "error": "Error message"
}
```

## DynamoDB Table Structure

**Table Name**: `lf-apikey-mappings-isolated-{environment}`

**Schema:**
```
apiKey (String, Partition Key)  →  IAM Role ARN
```

**Example Items:**
```json
{
  "apiKey": "AbCd1234567890...",
  "roleArn": "arn:aws:iam::123456789012:role/lf-apikey-dev-user-role-dev",
  "userName": "dev-user-isolated",
  "permissions": "limited",
  "source": "api-apikey-stack"
}
```

## Cleanup

```bash
aws cloudformation delete-stack --stack-name lf-apikey-poc-dev
```

**Note**: Delete in reverse order if stacks fail:
1. API Stack
2. Lambda Stack
3. IAM Stack

## Security Considerations

1. **API Keys**: Stored in API Gateway, retrieved via custom resource
2. **IAM Roles**: Strict AssumeRole trust policy (only Lambda can assume)
3. **Lake Formation**: Actual data access controlled by LF tags, not IAM
4. **Principle of Least Privilege**: Dev role has minimal permissions

## Troubleshooting

### Check DynamoDB Mappings
```bash
aws dynamodb scan \
  --table-name lf-apikey-mappings-isolated-dev \
  --region us-east-1
```

### Check Lambda Logs
```bash
aws logs tail /aws/lambda/lf-athena-apikey-handler-dev \
  --since 10m \
  --follow
```

### Verify Athena Query Failure
```bash
# Get query execution ID from Lambda logs, then:
aws athena get-query-execution \
  --query-execution-id <ID> \
  --query 'QueryExecution.Status.StateChangeReason'
```
