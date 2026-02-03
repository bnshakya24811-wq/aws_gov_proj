# API Key Solution - Step-by-Step Deployment Guide

## 📋 Release Notes

**Version:** 1.0.0  
**Date:** January 29, 2026  
**Type:** New Feature - Isolated API Key Authentication Solution

### What's New
- ✨ Standalone API Key authentication Lambda (TypeScript)
- ✨ Dedicated API Gateway stack with /query endpoint
- ✨ Automated deployment and testing scripts
- ✨ Comprehensive documentation and visual guides

### Architecture
- Lambda function for API key → Role ARN → Athena query workflow
- API Gateway with API key validation and rate limiting
- Integration with existing Lake Formation TBAC infrastructure

---

## 🚀 Deployment Steps

### Prerequisites ✅

Before deploying, verify you have:

```bash
# 1. Check DynamoDB table exists
aws dynamodb describe-table \
  --table-name lf-api-key-mappings-dev \
  --region ap-southeast-2

# 2. Check Lake Formation roles exist
aws iam get-role --role-name lf-dev-user-role-o-sp6-dev
aws iam get-role --role-name lf-super-user-role-o-sp6-dev

# 3. Check Glue database exists
aws glue get-database \
  --name lf-lh-silver-db-o-sp6-dev \
  --region ap-southeast-2

# 4. Check S3 bucket for deployment artifacts
aws s3 ls s3://deploymen-bkt/
```

**Required Values:**
- Environment: `dev`
- Region: `ap-southeast-2`
- S3 Bucket: `deploymen-bkt`
- DynamoDB Table: `lf-api-key-mappings-dev`
- Database: `lf-lh-silver-db-o-sp6-dev`
- LF Dev Role ARN: `arn:aws:iam::ACCOUNT:role/lf-dev-user-role-o-sp6-dev`
- LF Super Role ARN: `arn:aws:iam::ACCOUNT:role/lf-super-user-role-o-sp6-dev`

---

### Step 1: Build Lambda Package 📦

```bash
cd /home/bipinns/repos/github/lakehouse_access_control_poc/lf-lh-gov-nested/lambdas-ts-apikey

# Install dependencies
npm install

# Build TypeScript
npm run build

# Create deployment package
cd dist
zip -r ../lambda.zip .
cd ..

# Verify package
ls -lh lambda.zip
```

**Expected Output:**
```
lambda.zip created (approximately 150-200 KB)
```

---

### Step 2: Upload Lambda to S3 ☁️

```bash
# Upload Lambda package
aws s3 cp lambda.zip s3://deploymen-bkt/lambda/athena-query-apikey-dev.zip \
  --region ap-southeast-2

# Verify upload
aws s3 ls s3://deploymen-bkt/lambda/athena-query-apikey-dev.zip
```

**Expected Output:**
```
2026-01-29 XX:XX:XX    XXXXXX lambda/athena-query-apikey-dev.zip
```

---

### Step 3: Upload CloudFormation Templates (Optional) 📤

If integrating with master template:

```bash
cd /home/bipinns/repos/github/lakehouse_access_control_poc/lf-lh-gov-nested

# Upload Lambda stack template
aws s3 cp lambda-apikey-stack.yaml \
  s3://deploymen-bkt/lf-nested-stacks/lambda-apikey-stack.yaml \
  --region ap-southeast-2

# Upload API stack template
aws s3 cp api-apikey-stack.yaml \
  s3://deploymen-bkt/lf-nested-stacks/api-apikey-stack.yaml \
  --region ap-southeast-2

# Verify uploads
aws s3 ls s3://deploymen-bkt/lf-nested-stacks/ | grep apikey
```

---

### Step 4: Deploy Lambda Stack 🚀

```bash
cd /home/bipinns/repos/github/lakehouse_access_control_poc/lf-lh-gov-nested

# Get IAM role ARNs (update with your account ID)
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
LF_DEV_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/lf-dev-user-role-o-sp6-dev"
LF_SUPER_ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/lf-super-user-role-o-sp6-dev"

# Deploy Lambda stack
aws cloudformation create-stack \
  --stack-name lf-lambda-apikey-dev \
  --template-body file://lambda-apikey-stack.yaml \
  --parameters \
    ParameterKey=Environment,ParameterValue=dev \
    ParameterKey=LFDevUserArn,ParameterValue=$LF_DEV_ROLE_ARN \
    ParameterKey=LFSuperUserArn,ParameterValue=$LF_SUPER_ROLE_ARN \
    ParameterKey=APIKeyMappingTableName,ParameterValue=lf-api-key-mappings-dev \
    ParameterKey=DatabaseName,ParameterValue=lf-lh-silver-db-o-sp6-dev \
    ParameterKey=LambdaCodeS3Bucket,ParameterValue=deploymen-bkt \
    ParameterKey=LambdaCodeS3Key,ParameterValue=lambda/athena-query-apikey-dev.zip \
  --capabilities CAPABILITY_NAMED_IAM \
  --region ap-southeast-2 \
  --tags \
    Key=Project,Value=LakeFormationAccessControl \
    Key=Environment,Value=dev \
    Key=Component,Value=APIKeyLambda

# Wait for stack creation
aws cloudformation wait stack-create-complete \
  --stack-name lf-lambda-apikey-dev \
  --region ap-southeast-2

# Verify stack status
aws cloudformation describe-stacks \
  --stack-name lf-lambda-apikey-dev \
  --region ap-southeast-2 \
  --query 'Stacks[0].StackStatus'
```

**Expected Output:**
```
"CREATE_COMPLETE"
```

**Get Lambda ARN:**
```bash
LAMBDA_ARN=$(aws cloudformation describe-stacks \
  --stack-name lf-lambda-apikey-dev \
  --region ap-southeast-2 \
  --query 'Stacks[0].Outputs[?OutputKey==`LambdaFunctionArn`].OutputValue' \
  --output text)

echo "Lambda ARN: $LAMBDA_ARN"
```

---

### Step 5: Deploy API Gateway Stack 🌐

```bash
# Deploy API Gateway stack
aws cloudformation create-stack \
  --stack-name lf-api-apikey-dev \
  --template-body file://api-apikey-stack.yaml \
  --parameters \
    ParameterKey=Environment,ParameterValue=dev \
    ParameterKey=LambdaFunctionArn,ParameterValue=$LAMBDA_ARN \
  --region ap-southeast-2 \
  --tags \
    Key=Project,Value=LakeFormationAccessControl \
    Key=Environment,Value=dev \
    Key=Component,Value=APIKeyGateway

# Wait for stack creation
aws cloudformation wait stack-create-complete \
  --stack-name lf-api-apikey-dev \
  --region ap-southeast-2

# Verify stack status
aws cloudformation describe-stacks \
  --stack-name lf-api-apikey-dev \
  --region ap-southeast-2 \
  --query 'Stacks[0].StackStatus'
```

**Expected Output:**
```
"CREATE_COMPLETE"
```

---

### Step 6: Retrieve Deployment Outputs 📊

```bash
# Get API endpoint
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name lf-api-apikey-dev \
  --region ap-southeast-2 \
  --query 'Stacks[0].Outputs[?OutputKey==`QueryEndpoint`].OutputValue' \
  --output text)

echo "API Endpoint: $API_ENDPOINT"

# Get API Key ID
API_KEY_ID=$(aws cloudformation describe-stacks \
  --stack-name lf-api-apikey-dev \
  --region ap-southeast-2 \
  --query 'Stacks[0].Outputs[?OutputKey==`DemoApiKeyId`].OutputValue' \
  --output text)

# Get API Key value
API_KEY=$(aws apigateway get-api-key \
  --api-key $API_KEY_ID \
  --include-value \
  --region ap-southeast-2 \
  --query 'value' \
  --output text)

echo "Demo API Key: $API_KEY"

# Save to file for reference
cat > apikey-deployment-outputs.txt << EOF
API Key Solution Deployment Outputs
=====================================
Date: $(date)
Environment: dev
Region: ap-southeast-2

Stacks:
  - Lambda Stack: lf-lambda-apikey-dev
  - API Stack: lf-api-apikey-dev

Resources:
  - Lambda ARN: $LAMBDA_ARN
  - API Endpoint: $API_ENDPOINT
  - Demo API Key: $API_KEY

CloudWatch Logs:
  - /aws/lambda/lf-athena-apikey-handler-dev
EOF

cat apikey-deployment-outputs.txt
```

---

### Step 7: Create API Key Mappings in DynamoDB 🗄️

```bash
# Create mapping for dev user
aws dynamodb put-item \
  --table-name lf-api-key-mappings-dev \
  --item "{
    \"apiKey\": {\"S\": \"$API_KEY\"},
    \"roleArn\": {\"S\": \"$LF_DEV_ROLE_ARN\"},
    \"userName\": {\"S\": \"demo-dev-user\"},
    \"permissions\": {\"S\": \"silver-db-read\"}
  }" \
  --region ap-southeast-2

# Verify mapping
aws dynamodb get-item \
  --table-name lf-api-key-mappings-dev \
  --key "{\"apiKey\": {\"S\": \"$API_KEY\"}}" \
  --region ap-southeast-2
```

---

### Step 8: Test the Deployment ✅

```bash
# Test 1: Valid request
echo "Test 1: Valid API Key Request"
curl -X POST "$API_ENDPOINT" \
  -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "tableName": "members",
    "limit": 5
  }' | jq

# Test 2: Missing API key (should fail)
echo "Test 2: Missing API Key"
curl -X POST "$API_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{"tableName": "members"}' | jq

# Test 3: Invalid API key (should fail)
echo "Test 3: Invalid API Key"
curl -X POST "$API_ENDPOINT" \
  -H "x-api-key: invalid-key-12345" \
  -H "Content-Type: application/json" \
  -d '{"tableName": "members"}' | jq
```

**Expected Test 1 Output:**
```json
{
  "success": true,
  "query": "SELECT * FROM \"lf-lh-silver-db-o-sp6-dev\".\"members\" LIMIT 5",
  "rowCount": 5,
  "data": [...]
}
```

---

### Step 9: Verify CloudWatch Logs 📝

```bash
# Tail Lambda logs
aws logs tail /aws/lambda/lf-athena-apikey-handler-dev \
  --follow \
  --region ap-southeast-2

# Or view recent logs
aws logs tail /aws/lambda/lf-athena-apikey-handler-dev \
  --since 10m \
  --region ap-southeast-2
```

---

### Step 10: (Optional) Integrate with Master Template 🔗

If you want to add this to your existing master stack:

1. **Update main.yaml** - Add the nested stacks:

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
      - DynamoDBStack
    Properties:
      TemplateURL: !Sub https://${TemplateS3Bucket}.s3.amazonaws.com/${TemplateS3Prefix}/lambda-apikey-stack.yaml
      Parameters:
        Environment: !Ref Environment
        LFDevUserArn: !GetAtt IAMStack.Outputs.LFDevUserRoleArn
        LFSuperUserArn: !GetAtt IAMStack.Outputs.LFSuperUserRoleArn
        APIKeyMappingTableName: !GetAtt DynamoDBStack.Outputs.ApiKeyTableName
        DatabaseName: !GetAtt GlueStack.Outputs.DatabaseName
        LambdaCodeS3Bucket: !Ref LambdaCodeS3Bucket
        LambdaCodeS3Key: lambda/athena-query-apikey-dev.zip

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

2. **Update master stack:**

```bash
aws cloudformation update-stack \
  --stack-name lf-lh-master-stack-o-sp6-dev \
  --template-body file://main.yaml \
  --parameters \
    ParameterKey=Environment,ParameterValue=dev \
    ParameterKey=EnableOAuth,ParameterValue=true \
    ParameterKey=EnableApiKeyStack,ParameterValue=true \
    ParameterKey=CognitoUserPoolId,UsePreviousValue=true \
    ParameterKey=CognitoAppClientId,UsePreviousValue=true \
    ParameterKey=TemplateS3Bucket,UsePreviousValue=true \
    ParameterKey=LambdaCodeS3Bucket,UsePreviousValue=true \
    ParameterKey=TemplateS3Prefix,UsePreviousValue=true \
  --capabilities CAPABILITY_NAMED_IAM \
  --region ap-southeast-2
```

---

## ✅ Post-Deployment Checklist

- [ ] Lambda stack deployed successfully
- [ ] API Gateway stack deployed successfully
- [ ] API endpoint accessible
- [ ] Demo API key created
- [ ] DynamoDB mapping created
- [ ] Test requests successful
- [ ] CloudWatch logs showing activity
- [ ] Outputs saved to `apikey-deployment-outputs.txt`

---

## 📊 Monitoring & Verification

### Check Stack Status
```bash
aws cloudformation describe-stacks \
  --stack-name lf-lambda-apikey-dev \
  --region ap-southeast-2 \
  --query 'Stacks[0].{Status:StackStatus,Created:CreationTime}'

aws cloudformation describe-stacks \
  --stack-name lf-api-apikey-dev \
  --region ap-southeast-2 \
  --query 'Stacks[0].{Status:StackStatus,Created:CreationTime}'
```

### Monitor Lambda Metrics
```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=lf-athena-apikey-handler-dev \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum \
  --region ap-southeast-2
```

### Check API Gateway Metrics
```bash
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGateway \
  --metric-name Count \
  --dimensions Name=ApiName,Value=lf-athena-apikey-api-dev \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum \
  --region ap-southeast-2
```

---

## 🔄 Rollback Procedure

If deployment fails or issues arise:

```bash
# Delete API Gateway stack first
aws cloudformation delete-stack \
  --stack-name lf-api-apikey-dev \
  --region ap-southeast-2

aws cloudformation wait stack-delete-complete \
  --stack-name lf-api-apikey-dev \
  --region ap-southeast-2

# Delete Lambda stack
aws cloudformation delete-stack \
  --stack-name lf-lambda-apikey-dev \
  --region ap-southeast-2

aws cloudformation wait stack-delete-complete \
  --stack-name lf-lambda-apikey-dev \
  --region ap-southeast-2

# Remove Lambda package from S3
aws s3 rm s3://deploymen-bkt/lambda/athena-query-apikey-dev.zip
```

---

## 🎯 Success Criteria

✅ **Lambda Stack:**
- Status: CREATE_COMPLETE
- Lambda function created and accessible
- IAM role has correct permissions
- CloudWatch log group exists

✅ **API Gateway Stack:**
- Status: CREATE_COMPLETE
- API endpoint returns valid URL
- Demo API key created
- Usage plan configured

✅ **Functionality:**
- Valid requests return 200 with data
- Invalid API key returns 403
- Missing API key returns 401
- CloudWatch logs show activity

✅ **Integration:**
- DynamoDB lookup works
- Role assumption successful
- Athena queries execute
- Lake Formation TBAC enforced

---

## 📞 Support & Troubleshooting

**Common Issues:**

1. **"InvalidParameterValueException" during Lambda stack creation**
   - Verify Lambda package exists in S3
   - Check S3 bucket name and key are correct

2. **"AccessDeniedException" in CloudWatch logs**
   - Verify Lake Formation role trust policy
   - Check Lambda execution role has AssumeRole permission

3. **API Gateway returns 403 "Forbidden"**
   - Verify API key is valid and enabled
   - Check API key is associated with usage plan

4. **Lambda times out**
   - Check DynamoDB table name is correct
   - Verify network connectivity to AWS services

**Logs to Check:**
```bash
# Lambda execution logs
aws logs tail /aws/lambda/lf-athena-apikey-handler-dev --region ap-southeast-2

# CloudFormation events
aws cloudformation describe-stack-events \
  --stack-name lf-lambda-apikey-dev \
  --region ap-southeast-2 \
  --max-items 20
```

---

## 📝 Deployment Summary

**Stacks Created:**
1. `lf-lambda-apikey-dev` - Lambda function and execution role
2. `lf-api-apikey-dev` - API Gateway with /query endpoint

**Resources Created:**
- Lambda Function: `lf-athena-apikey-handler-dev`
- API Gateway: `lf-athena-apikey-api-dev`
- API Key: Demo API key for testing
- CloudWatch Log Group: `/aws/lambda/lf-athena-apikey-handler-dev`

**Integration Points:**
- DynamoDB: `lf-api-key-mappings-dev`
- IAM Roles: `lf-dev-user-role-o-sp6-dev`, `lf-super-user-role-o-sp6-dev`
- Glue Database: `lf-lh-silver-db-o-sp6-dev`

---

🎉 **Deployment Complete!** Your API Key authentication solution is now live and ready to use.
