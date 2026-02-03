# API Key Solution - Quick Reference

## 🚀 Quick Start

### Build & Deploy
```bash
cd lf-lh-gov-nested
./deploy-apikey-solution.sh dev deploymen-bkt us-east-1
```

### Test
```bash
./test-apikey-solution.sh dev us-east-1
```

## 📁 File Structure

```
lf-lh-gov-nested/
├── lambdas-ts-apikey/           # Lambda TypeScript code (isolated)
│   ├── src/
│   │   ├── index.ts              # Main handler (API key only)
│   │   ├── config.ts             # Environment config
│   │   ├── types.ts              # TypeScript types
│   │   ├── services/
│   │   │   ├── apiKeyService.ts  # DynamoDB lookup
│   │   │   ├── roleService.ts    # STS AssumeRole
│   │   │   └── athenaService.ts  # Athena query execution
│   │   └── utils/
│   │       ├── errorHandler.ts   # Error responses
│   │       └── logger.ts         # Structured logging
│   ├── package.json
│   ├── tsconfig.json
│   └── build.sh                  # Build script
│
├── lambda-apikey-stack.yaml      # Lambda CloudFormation template
├── api-apikey-stack.yaml         # API Gateway CloudFormation template
├── deploy-apikey-solution.sh     # Deployment script
├── test-apikey-solution.sh       # Test script
└── APIKEY_SOLUTION_README.md     # Full documentation
```

## 🔧 Manual Commands

### Build Lambda
```bash
cd lambdas-ts-apikey
npm install
npm run build
npm run package  # Creates lambda.zip
```

### Upload to S3
```bash
aws s3 cp lambdas-ts-apikey/lambda.zip \
  s3://YOUR-BUCKET/lambda/athena-query-apikey.zip
```

### Deploy Lambda Stack
```bash
aws cloudformation deploy \
  --stack-name lf-lambda-apikey-dev \
  --template-file lambda-apikey-stack.yaml \
  --parameter-overrides \
    Environment=dev \
    LFDevUserArn=arn:aws:iam::ACCOUNT:role/lf-dev-role \
    LFSuperUserArn=arn:aws:iam::ACCOUNT:role/lf-super-role \
    APIKeyMappingTableName=lf-api-key-mappings \
    DatabaseName=lf-lh-silver-db \
    LambdaCodeS3Bucket=YOUR-BUCKET \
    LambdaCodeS3Key=lambda/athena-query-apikey.zip \
  --capabilities CAPABILITY_NAMED_IAM
```

### Deploy API Stack
```bash
# Get Lambda ARN first
LAMBDA_ARN=$(aws cloudformation describe-stacks \
  --stack-name lf-lambda-apikey-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`LambdaFunctionArn`].OutputValue' \
  --output text)

aws cloudformation deploy \
  --stack-name lf-api-apikey-dev \
  --template-file api-apikey-stack.yaml \
  --parameter-overrides \
    Environment=dev \
    LambdaFunctionArn=$LAMBDA_ARN
```

## 🧪 Testing

### Get API Key
```bash
API_KEY=$(aws apigateway get-api-key \
  --api-key $(aws cloudformation describe-stacks \
    --stack-name lf-api-apikey-dev \
    --query 'Stacks[0].Outputs[?OutputKey==`DemoApiKeyId`].OutputValue' \
    --output text) \
  --include-value \
  --query 'value' \
  --output text)
```

### Get Endpoint
```bash
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name lf-api-apikey-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`QueryEndpoint`].OutputValue' \
  --output text)
```

### Test Request
```bash
curl -X POST "$API_ENDPOINT" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tableName": "members",
    "limit": 10
  }' | jq
```

## 🗄️ DynamoDB Setup

### Create API Key Mapping
```bash
aws dynamodb put-item \
  --table-name lf-api-key-mappings \
  --item '{
    "apiKey": {"S": "demo-key-abc123"},
    "roleArn": {"S": "arn:aws:iam::ACCOUNT:role/lf-dev-user-role"},
    "userName": {"S": "demo-user"},
    "permissions": {"S": "read-only"}
  }'
```

### Query Mapping
```bash
aws dynamodb get-item \
  --table-name lf-api-key-mappings \
  --key '{"apiKey": {"S": "demo-key-abc123"}}'
```

## 📊 Monitoring

### View Lambda Logs
```bash
aws logs tail /aws/lambda/lf-athena-apikey-handler-dev --follow
```

### Check Lambda Metrics
```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=lf-athena-apikey-handler-dev \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

### Check API Gateway Metrics
```bash
API_ID=$(aws cloudformation describe-stacks \
  --stack-name lf-api-apikey-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiId`].OutputValue' \
  --output text)

aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGateway \
  --metric-name Count \
  --dimensions Name=ApiName,Value=lf-athena-apikey-api-dev \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

## 🧹 Cleanup

```bash
# Delete API stack
aws cloudformation delete-stack --stack-name lf-api-apikey-dev
aws cloudformation wait stack-delete-complete --stack-name lf-api-apikey-dev

# Delete Lambda stack
aws cloudformation delete-stack --stack-name lf-lambda-apikey-dev
aws cloudformation wait stack-delete-complete --stack-name lf-lambda-apikey-dev

# Delete Lambda package from S3
aws s3 rm s3://YOUR-BUCKET/lambda/athena-query-apikey.zip
```

## 🔗 Integration with Master Template

Add to existing `main.yaml`:

```yaml
  ApiKeyLambdaStack:
    Type: AWS::CloudFormation::Stack
    Condition: EnableApiKey  # Add condition
    DependsOn: [IAMStack, GlueStack]
    Properties:
      TemplateURL: !Sub https://${TemplateS3Bucket}.s3.amazonaws.com/${TemplateS3Prefix}/lambda-apikey-stack.yaml
      Parameters:
        Environment: !Ref Environment
        LFDevUserArn: !GetAtt IAMStack.Outputs.LFDevUserRoleArn
        LFSuperUserArn: !GetAtt IAMStack.Outputs.LFSuperUserRoleArn
        APIKeyMappingTableName: !GetAtt DynamoDBStack.Outputs.ApiKeyTableName
        DatabaseName: !GetAtt GlueStack.Outputs.DatabaseName
        LambdaCodeS3Bucket: !Ref LambdaCodeS3Bucket

  ApiKeyAPIStack:
    Type: AWS::CloudFormation::Stack
    Condition: EnableApiKey
    DependsOn: ApiKeyLambdaStack
    Properties:
      TemplateURL: !Sub https://${TemplateS3Bucket}.s3.amazonaws.com/${TemplateS3Prefix}/api-apikey-stack.yaml
      Parameters:
        Environment: !Ref Environment
        LambdaFunctionArn: !GetAtt ApiKeyLambdaStack.Outputs.LambdaFunctionArn
```

## 📝 Request/Response Examples

### Request
```json
{
  "tableName": "members",
  "limit": 10
}
```

### Success Response
```json
{
  "success": true,
  "query": "SELECT * FROM \"lf-lh-silver-db\".\"members\" LIMIT 10",
  "rowCount": 10,
  "data": [
    ["id", "name", "email", "ssn"],
    ["1", "John", "john@example.com", "***-**-1234"],
    ...
  ]
}
```

### Error Response
```json
{
  "success": false,
  "error": "Invalid API key"
}
```

## ⚡ Key Differences from Multi-Auth Lambda

| Aspect | Multi-Auth Lambda | API Key Lambda |
|--------|------------------|----------------|
| Auth Methods | API Key, IAM, OAuth | API Key only |
| Code Size | ~300 KB | ~150 KB |
| Dependencies | 5 AWS SDKs | 3 AWS SDKs |
| Request Body | `tableName` or `query` | `tableName` only |
| Complexity | High (3 auth flows) | Low (1 auth flow) |
| Use Case | Flexible auth | Simple, fast |

## 🎯 Use Cases

- **Production API:** Clean, focused solution for API key auth
- **Microservices:** Isolated service for Lake Formation queries
- **Testing:** Simplified debugging with single auth path
- **Migration:** Drop-in replacement for API key endpoints
- **Templates:** Reusable pattern for other services
