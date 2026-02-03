# API Key Authentication Solution for Lake Formation

## Overview

This is an **isolated, production-ready solution** for API key-based authentication to query AWS Athena tables with Lake Formation Tag-Based Access Control (TBAC).

### Architecture

```
Client → API Gateway → Lambda → AssumeRole → Athena Query → Results
         (API Key)    (TS)      (LF Role)    (TBAC)
```

**Workflow:**
1. Client sends request with `x-api-key` header and `tableName` in body
2. API Gateway validates API key and routes to Lambda
3. Lambda looks up IAM role ARN from DynamoDB using API key
4. Lambda assumes the Lake Formation role
5. Lambda executes Athena query with assumed credentials
6. Lake Formation enforces tag-based permissions
7. Lambda returns query results

## Components

### 1. Lambda Code (`lambdas-ts-apikey/`)
- **Language:** TypeScript (Node.js 20.x)
- **Services:**
  - `apiKeyService.ts` - DynamoDB lookup for API key → Role mapping
  - `roleService.ts` - STS AssumeRole operations
  - `athenaService.ts` - Athena query execution
- **Authentication:** API Key only (no OAuth, no IAM user)
- **Clean separation:** Isolated from multi-auth Lambda

### 2. Lambda Stack (`lambda-apikey-stack.yaml`)
- Lambda function with execution role
- IAM policies for:
  - Assuming Lake Formation roles
  - DynamoDB read access (API key table)
  - Athena query execution
  - S3 query results access
- CloudWatch log group

### 3. API Stack (`api-apikey-stack.yaml`)
- API Gateway REST API
- `/query` POST endpoint with API key required
- CORS support (OPTIONS method)
- Demo API key and usage plan
- Rate limiting: 50 requests/sec, 10k per day

## Deployment

### Prerequisites

1. **Existing Infrastructure** (deployed separately):
   - DynamoDB table with API key mappings
   - Lake Formation Dev and Super User roles
   - Glue database with tables
   - S3 bucket for templates

2. **Lambda Code Build:**
   ```bash
   cd lambdas-ts-apikey
   npm install
   bash build.sh
   ```

3. **Upload Lambda Package:**
   ```bash
   aws s3 cp lambda.zip s3://YOUR-BUCKET/lambda/athena-query-apikey.zip
   ```

### Standalone Deployment

Deploy both stacks with dependencies:

```bash
# Deploy Lambda stack
aws cloudformation create-stack \
  --stack-name lf-lambda-apikey-dev \
  --template-body file://lambda-apikey-stack.yaml \
  --parameters \
    ParameterKey=Environment,ParameterValue=dev \
    ParameterKey=LFDevUserArn,ParameterValue=arn:aws:iam::ACCOUNT:role/lf-dev-role \
    ParameterKey=LFSuperUserArn,ParameterValue=arn:aws:iam::ACCOUNT:role/lf-super-role \
    ParameterKey=APIKeyMappingTableName,ParameterValue=lf-api-key-mappings \
    ParameterKey=DatabaseName,ParameterValue=lf-lh-silver-db \
    ParameterKey=LambdaCodeS3Bucket,ParameterValue=YOUR-BUCKET \
    ParameterKey=LambdaCodeS3Key,ParameterValue=lambda/athena-query-apikey.zip \
  --capabilities CAPABILITY_NAMED_IAM

# Wait for Lambda stack to complete
aws cloudformation wait stack-create-complete --stack-name lf-lambda-apikey-dev

# Get Lambda ARN
LAMBDA_ARN=$(aws cloudformation describe-stacks \
  --stack-name lf-lambda-apikey-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`LambdaFunctionArn`].OutputValue' \
  --output text)

# Deploy API stack
aws cloudformation create-stack \
  --stack-name lf-api-apikey-dev \
  --template-body file://api-apikey-stack.yaml \
  --parameters \
    ParameterKey=Environment,ParameterValue=dev \
    ParameterKey=LambdaFunctionArn,ParameterValue=$LAMBDA_ARN

# Wait for API stack
aws cloudformation wait stack-create-complete --stack-name lf-api-apikey-dev
```

### Integration with Master Template

Add to `main.yaml`:

```yaml
Parameters:
  EnableApiKeyStack:
    Type: String
    Default: 'false'
    AllowedValues: ['true', 'false']

Conditions:
  EnableApiKey: !Equals [!Ref EnableApiKeyStack, 'true']

Resources:
  # ... existing stacks ...

  ApiKeyLambdaStack:
    Type: AWS::CloudFormation::Stack
    Condition: EnableApiKey
    DependsOn:
      - IAMStack
      - GlueStack
      - DynamoDBStack  # If you have one
    Properties:
      TemplateURL: !Sub https://${TemplateS3Bucket}.s3.amazonaws.com/${TemplateS3Prefix}/lambda-apikey-stack.yaml
      Parameters:
        Environment: !Ref Environment
        LFDevUserArn: !GetAtt IAMStack.Outputs.LFDevUserRoleArn
        LFSuperUserArn: !GetAtt IAMStack.Outputs.LFSuperUserRoleArn
        APIKeyMappingTableName: !GetAtt DynamoDBStack.Outputs.ApiKeyTableName
        DatabaseName: !GetAtt GlueStack.Outputs.DatabaseName
        LambdaCodeS3Bucket: !Ref LambdaCodeS3Bucket
        LambdaCodeS3Key: lambda/athena-query-apikey.zip

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

## Testing

### 1. Get API Key Value

```bash
API_KEY=$(aws apigateway get-api-key \
  --api-key $(aws cloudformation describe-stacks \
    --stack-name lf-api-apikey-dev \
    --query 'Stacks[0].Outputs[?OutputKey==`DemoApiKeyId`].OutputValue' \
    --output text) \
  --include-value \
  --query 'value' \
  --output text)

echo "API Key: $API_KEY"
```

### 2. Get Endpoint URL

```bash
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name lf-api-apikey-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`QueryEndpoint`].OutputValue' \
  --output text)

echo "Endpoint: $API_ENDPOINT"
```

### 3. Test Query

```bash
curl -X POST "$API_ENDPOINT" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tableName": "members",
    "limit": 10
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "query": "SELECT * FROM \"lf-lh-silver-db\".\"members\" LIMIT 10",
  "rowCount": 10,
  "data": [
    ["id", "name", "email", "ssn"],
    ["1", "John Doe", "john@example.com", "***-**-1234"],
    ...
  ]
}
```

### 4. Test Error Cases

**Missing API Key:**
```bash
curl -X POST "$API_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{"tableName": "members"}'

# Response: {"success": false, "error": "Missing API key: provide x-api-key header"}
```

**Invalid API Key:**
```bash
curl -X POST "$API_ENDPOINT" \
  -H "x-api-key: invalid-key-12345" \
  -H "Content-Type: application/json" \
  -d '{"tableName": "members"}'

# Response: {"success": false, "error": "Invalid API key"}
```

## DynamoDB Table Structure

The API key mapping table should have this structure:

```json
{
  "apiKey": "abc123xyz456",
  "roleArn": "arn:aws:iam::123456789012:role/lf-dev-user-role",
  "userName": "dev-user-1",
  "permissions": "silver-db-read"
}
```

**Create sample mapping:**
```bash
aws dynamodb put-item \
  --table-name lf-api-key-mappings \
  --item '{
    "apiKey": {"S": "demo-key-12345"},
    "roleArn": {"S": "arn:aws:iam::ACCOUNT:role/lf-dev-user-role"},
    "userName": {"S": "demo-user"},
    "permissions": {"S": "read-only"}
  }'
```

## Security Considerations

1. **API Key Rotation:** Implement regular key rotation (not in this POC)
2. **Rate Limiting:** Configured via Usage Plan (50 req/sec, 10k/day)
3. **HTTPS Only:** API Gateway enforces TLS
4. **Least Privilege:** Lambda can only assume specified LF roles
5. **Audit Logging:** CloudWatch logs all requests
6. **Secrets Management:** Consider AWS Secrets Manager for keys in production

## Cost Optimization

- **Lambda Memory:** 512 MB (adjust based on query complexity)
- **Lambda Timeout:** 300 seconds (5 minutes)
- **Log Retention:** 7 days (adjustable in template)
- **API Gateway Caching:** Not enabled (add if needed)

## Monitoring

**CloudWatch Metrics:**
- Lambda invocations, errors, duration
- API Gateway 4XX/5XX errors, latency
- DynamoDB read throttling

**CloudWatch Logs:**
- Lambda logs: `/aws/lambda/lf-athena-apikey-handler-{env}`
- API Gateway access logs (enable in template if needed)

**Sample Log Query:**
```
fields @timestamp, @message
| filter context = "ApiKeyLambdaHandler"
| sort @timestamp desc
| limit 20
```

## Cleanup

```bash
# Delete stacks in reverse order
aws cloudformation delete-stack --stack-name lf-api-apikey-dev
aws cloudformation wait stack-delete-complete --stack-name lf-api-apikey-dev

aws cloudformation delete-stack --stack-name lf-lambda-apikey-dev
aws cloudformation wait stack-delete-complete --stack-name lf-lambda-apikey-dev
```

## Troubleshooting

### Lambda Errors

**"Invalid API key"**
- Check DynamoDB table has the API key
- Verify key is passed correctly in `x-api-key` header

**"Failed to assume role"**
- Verify Lambda role has `sts:AssumeRole` permission
- Check Lake Formation role trust policy allows Lambda role

**"Query failed with status: FAILED"**
- Check CloudWatch logs for Athena error details
- Verify Lake Formation permissions on table
- Ensure IAMAllowedPrincipals is revoked

### API Gateway Errors

**"Forbidden"**
- Verify API key is valid and enabled
- Check API key is associated with usage plan

**"Missing Authentication Token"**
- Verify endpoint URL is correct
- Check API Gateway deployment is active

## Migration from Multi-Auth Lambda

If migrating from the existing multi-auth Lambda:

1. **Database Compatibility:** Uses same DynamoDB table structure
2. **Request Format:** Same JSON body (`tableName`, `limit`)
3. **Response Format:** Identical response structure
4. **Drop-in Replacement:** Change endpoint URL only
5. **Gradual Migration:** Run both Lambdas simultaneously during transition

## Future Enhancements

- [ ] API key rotation Lambda
- [ ] CloudWatch alarms for error rates
- [ ] X-Ray tracing for debugging
- [ ] API Gateway request validation
- [ ] Custom authorizer for advanced logic
- [ ] Multi-region deployment
- [ ] Blue/green deployment pipeline

## License

MIT
