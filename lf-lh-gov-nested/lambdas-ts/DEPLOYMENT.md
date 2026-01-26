# TypeScript Lambda Deployment Guide

## Prerequisites

- Node.js 20.x installed
- AWS CLI configured
- S3 bucket for Lambda code storage

## Quick Deployment Steps

### Option 1: Direct Lambda Update (Fastest)

For updating an existing Lambda function:

```bash
cd lf-lh-gov-nested/lambdas-ts

# Install dependencies (first time only)
npm install

# Build and deploy
./quick-deploy.sh dev
```

### Option 2: S3 + CloudFormation Update

For full CloudFormation stack updates:

```bash
cd lf-lh-gov-nested/lambdas-ts

# Install dependencies (first time only)
npm install

# Build, package, and upload to S3
./build-and-deploy.sh your-lambda-bucket-name dev

# Then update the CloudFormation stack
aws cloudformation update-stack \
  --stack-name lf-lh-lambda-stack-o-sp6-dev \
  --template-body file://../lambda-stack.yaml \
  --parameters \
    ParameterKey=Environment,ParameterValue=dev \
    ParameterKey=LambdaCodeS3Bucket,ParameterValue=your-lambda-bucket-name \
    ParameterKey=LambdaCodeS3Key,ParameterValue=lambda/athena-query-handler.zip \
    ... # other parameters
  --capabilities CAPABILITY_NAMED_IAM
```

### Option 3: Manual Build and Deploy

```bash
cd lf-lh-gov-nested/lambdas-ts

# 1. Install dependencies
npm install

# 2. Build TypeScript
npm run build

# 3. Create ZIP package
cd dist
zip -r ../lambda.zip . -x "*.map"
cd ..

# 4. Upload to S3 (if using S3 deployment)
aws s3 cp lambda.zip s3://your-bucket/lambda/athena-query-handler.zip

# 5. Update Lambda function directly
aws lambda update-function-code \
  --function-name lf-athena-query-handler-o-sp6-dev \
  --zip-file fileb://lambda.zip
```

## Verification

After deployment, test the Lambda function:

### Test with Super User (Full PII Access)
```bash
curl -X POST https://s61dm9xt8i.execute-api.ap-southeast-2.amazonaws.com/dev/query \
  -H "x-api-key: lPhl4UQwde7lcfWs1xLag1lX6BYoclGR8lk2FjUp" \
  -H "Content-Type: application/json" \
  -d '{"tableName": "lf_lh_silver_bkt_o_sp5_dev", "limit": 5}' | jq
```

**Expected**: Should return `member_id` and `ssn` columns

### Test with Dev User (Restricted)
```bash
curl -X POST https://s61dm9xt8i.execute-api.ap-southeast-2.amazonaws.com/dev/query \
  -H "x-api-key: y0cTvXBvoH44hlxezvJTlgN55AmIdh13KSIeYp50" \
  -H "Content-Type: application/json" \
  -d '{"tableName": "lf_lh_silver_bkt_o_sp5_dev", "limit": 5}' | jq
```

**Expected**: Should return only `member_id` column (PII filtered)

## Changes from Python Version

The Lambda stack has been updated to use TypeScript:

- **Runtime**: `python3.11` → `nodejs20.x`
- **Handler**: `index.lambda_handler` → `index.handler`
- **Environment**: Added `LOG_LEVEL=INFO`

All other functionality remains identical.

## Troubleshooting

### Build Errors

If you see TypeScript compilation errors:
```bash
# Check TypeScript version
npx tsc --version

# Clean and rebuild
npm run clean
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Lambda Deployment Errors

If Lambda update fails:
```bash
# Check function exists
aws lambda get-function --function-name lf-athena-query-handler-o-sp6-dev

# Check Lambda execution role permissions
aws lambda get-function-configuration \
  --function-name lf-athena-query-handler-o-sp6-dev \
  --query 'Role'
```

### Runtime Errors

Check CloudWatch Logs:
```bash
aws logs tail /aws/lambda/lf-athena-query-handler-o-sp6-dev --follow
```

Common issues:
- Missing environment variables
- Incorrect IAM role permissions
- API key not found in DynamoDB
- Lake Formation permissions not configured

## Rollback to Python

If you need to revert to the Python version:

1. Update [lambda-stack.yaml](../lambda-stack.yaml):
   - Runtime: `nodejs20.x` → `python3.11`  
   - Handler: `index.handler` → `index.lambda_handler`

2. Package Python code:
   ```bash
   cd ../lambdas
   zip lambda.zip index.py
   aws s3 cp lambda.zip s3://your-bucket/lambda/athena-query-handler.zip
   ```

3. Update CloudFormation stack or Lambda directly

## Next Steps

- Add unit tests with Jest
- Add integration tests with AWS SAM
- Set up CI/CD pipeline
- Add X-Ray tracing for distributed tracing
- Add custom metrics to CloudWatch
