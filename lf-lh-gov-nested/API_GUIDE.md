# API Gateway + Lambda + Athena with Lake Formation TBAC

## Architecture Overview

This extension implements a secure API for querying Athena with Lake Formation Tag-Based Access Control (TBAC):

```
Client Request (API Key + Table Name)
        ↓
API Gateway (validates API key)
        ↓
Lambda Function
        ├→ Looks up IAM role in DynamoDB (based on API key)
        ├→ Assumes appropriate role (dev-user or super-user)
        └→ Executes Athena query with assumed credentials
        ↓
Lake Formation applies TBAC permissions
        ↓
Results returned (filtered by LF permissions)
```

## Key Components

### 1. **API Stack** ([api-stack.yaml](api-stack.yaml))
- REST API Gateway with `/query` endpoint
- API keys for dev-user and super-user
- Usage plan with throttling and quotas
- Lambda proxy integration

### 2. **Lambda Stack** ([lambda-stack.yaml](lambda-stack.yaml))
- Lambda function with STS AssumeRole permissions
- Can assume dev-user-role or super-user-role
- Environment variables for DynamoDB table and Athena config

### 3. **DynamoDB Stack** ([dynamodb-stack.yaml](dynamodb-stack.yaml))
- Table mapping API keys to IAM role ARNs
- Custom Lambda resource to populate initial mappings
- Stores: `{apiKey, roleArn, userName, permissions}`

### 4. **IAM Additions** ([iam-stack.yaml](iam-stack.yaml#L112-L198))
- `LFDevUserRole` - Assumable role with limited LF permissions
- `LFSuperUserRole` - Assumable role with full LF permissions
- Trust policy allows Lambda execution role to assume these

### 5. **Lambda Function** ([lambdas/index.py](lambdas/index.py))
- Validates API key from header
- Queries DynamoDB for role mapping
- Assumes role using STS
- Executes Athena query with assumed credentials
- Returns results (automatically filtered by LF TBAC)

## Deployment

### Prerequisites

1. Existing Lake Formation setup (IAM, Glue, Governance stacks)
2. S3 bucket for templates and Lambda code
3. AWS CLI configured with appropriate credentials

### Deploy Command

```bash
chmod +x deploy-api.sh
./deploy-api.sh <environment> <s3-bucket-name>

# Example:
./deploy-api.sh dev my-cloudformation-templates-bucket
```

### Deployment Steps (Automated)

1. ✅ Package Lambda function code
2. ✅ Upload Lambda zip to S3
3. ✅ Upload all nested stack templates
4. ✅ Deploy master stack with 6 nested stacks:
   - IAM Stack (with new assumable roles)
   - Glue Stack
   - Governance Stack (with role permissions)
   - Lambda Stack
   - API Stack
   - DynamoDB Stack

## Testing the API

### 1. Get API Endpoint and Keys

```bash
STACK_NAME="lf-lh-main-o-sp6-dev"

API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --query 'Stacks[0].Outputs[?OutputKey==`APIEndpoint`].OutputValue' \
  --output text)

DEV_API_KEY=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --query 'Stacks[0].Outputs[?OutputKey==`DevUserAPIKey`].OutputValue' \
  --output text)

SUPER_API_KEY=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --query 'Stacks[0].Outputs[?OutputKey==`SuperUserAPIKey`].OutputValue' \
  --output text)
```

### 2. Test with Dev User (Limited Permissions)

```bash
# Dev user can only see non-PII columns
curl -X POST ${API_ENDPOINT} \
  -H "x-api-key: ${DEV_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "tableName": "members",
    "limit": 10
  }'
```

**Expected**: Returns data but **excludes PII columns** (e.g., `ssn`)

### 3. Test with Super User (Full Permissions)

```bash
# Super user can see all columns including PII
curl -X POST ${API_ENDPOINT} \
  -H "x-api-key: ${SUPER_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "tableName": "members",
    "limit": 10
  }'
```

**Expected**: Returns **all columns including PII**

### 4. Example Response

```json
{
  "success": true,
  "query": "SELECT * FROM lf-lh-silver-db-o-sp5-dev.members LIMIT 10",
  "rowCount": 10,
  "data": [
    ["id", "name", "email", "city"],
    ["1", "John Doe", "john@example.com", "New York"],
    ["2", "Jane Smith", "jane@example.com", "Los Angeles"]
  ]
}
```

## Security Model

### API Key → Role Mapping

```
Dev API Key    → Dev User Role    → LF Tags: PII=false only
Super API Key  → Super User Role  → LF Tags: PII=* (all)
```

### Lake Formation Permission Flow

1. Client calls API with API key
2. API Gateway validates key exists in usage plan
3. Lambda looks up `roleArn` in DynamoDB
4. Lambda assumes role using STS
5. Athena query executed with **temporary credentials** from assumed role
6. **Lake Formation intercepts query** and applies TBAC
7. Results filtered based on role's LF tag permissions

### IAM Trust Relationships

**Lambda Execution Role** can assume:
- `lf-lh-dev-user-role-o-sp6-{env}`
- `lf-lh-super-user-role-o-sp6-{env}`

**Dev User Role** has LF permissions:
- Database: `DESCRIBE` on `DBAccessScope=silver`
- Table: `SELECT` on `DBAccessScope=silver AND PII=false`

**Super User Role** has LF permissions:
- Database: `ALL` on `DBAccessScope=silver`
- Table: `ALL` on `DBAccessScope=silver AND PII=*`

## Adding New Users

To add a new API user:

1. **Create new API key in API Gateway**:
   ```bash
   aws apigateway create-api-key \
     --name new-user-api-key \
     --enabled
   ```

2. **Associate with usage plan**:
   ```bash
   aws apigateway create-usage-plan-key \
     --usage-plan-id <usage-plan-id> \
     --key-id <api-key-id> \
     --key-type API_KEY
   ```

3. **Add mapping in DynamoDB**:
   ```python
   import boto3
   
   dynamodb = boto3.resource('dynamodb')
   table = dynamodb.Table('lf-api-key-mappings-o-sp6-dev')
   
   table.put_item(Item={
       'apiKey': 'your-new-api-key-value',
       'roleArn': 'arn:aws:iam::123456789012:role/lf-lh-dev-user-role-o-sp6-dev',
       'userName': 'new-user',
       'permissions': 'limited'
   })
   ```

4. **Test the new key**:
   ```bash
   curl -X POST ${API_ENDPOINT} \
     -H "x-api-key: your-new-api-key-value" \
     -H "Content-Type: application/json" \
     -d '{"tableName": "members", "limit": 5}'
   ```

## Monitoring & Troubleshooting

### CloudWatch Logs

Lambda logs: `/aws/lambda/lf-athena-query-handler-o-sp6-{env}`

```bash
aws logs tail /aws/lambda/lf-athena-query-handler-o-sp6-dev --follow
```

### Common Issues

**403 Forbidden**: 
- Check API key is valid and associated with usage plan
- Verify API key value in DynamoDB matches actual key

**500 Internal Server Error**:
- Check Lambda CloudWatch logs
- Verify IAM role can be assumed (trust policy)
- Ensure Lake Formation permissions exist for role

**Empty Results**:
- LF permissions may be too restrictive
- Check role has DESCRIBE + SELECT on database/table
- Verify table has been tagged with LF tags

**Query Timeout**:
- Increase Lambda timeout in [lambda-stack.yaml](lambda-stack.yaml#L89)
- Check Athena query performance

## Cost Optimization

- **API Gateway**: Pay per request (~$3.50 per million)
- **Lambda**: Pay per invocation and duration (free tier: 1M requests/month)
- **Athena**: Pay per data scanned ($5 per TB)
- **DynamoDB**: On-demand pricing (pay per read/write)

**Recommendations**:
- Use Athena partitions to reduce data scanned
- Cache frequent queries in Lambda
- Set appropriate API Gateway throttling limits

## Cleanup

```bash
ENVIRONMENT=dev
STACK_NAME="lf-lh-main-o-sp6-${ENVIRONMENT}"

# Delete the entire stack (cascades to all nested stacks)
aws cloudformation delete-stack --stack-name ${STACK_NAME}

# Monitor deletion
aws cloudformation wait stack-delete-complete --stack-name ${STACK_NAME}

# Clean up S3 artifacts
aws s3 rm s3://your-cloudformation-templates-bucket/lf-nested-stacks/ --recursive
aws s3 rm s3://your-cloudformation-templates-bucket/lambda/ --recursive
```

## Architecture Benefits

✅ **Secure**: No credentials exposed; uses STS temporary credentials  
✅ **Scalable**: API Gateway + Lambda auto-scale  
✅ **Auditable**: CloudTrail logs all STS AssumeRole calls  
✅ **Flexible**: Easy to add new users without code changes  
✅ **Compliant**: Lake Formation enforces row/column-level security  
✅ **Cost-effective**: Pay only for actual usage  

## Future Enhancements

- [ ] Add Cognito User Pool for OAuth2/SAML authentication
- [ ] Implement query result caching (ElastiCache/DynamoDB)
- [ ] Add query history and analytics dashboard
- [ ] Support for parameterized queries (WHERE clauses)
- [ ] Implement rate limiting per user
- [ ] Add CloudWatch alarms for errors and latency
- [ ] Support for cross-account LF permissions
