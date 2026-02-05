# Lake Formation API Key Access Control - Serverless Framework

This implementation uses **Serverless Framework v3** to deploy the same working solution from `lf-api-key-poc` but with a serverless-native approach.

## Architecture

- **Framework**: Serverless Framework v3 (latest before v4)
- **Runtime**: Node.js 20.x
- **Language**: TypeScript
- **Authentication**: API Gateway API Keys
- **Authorization**: Lake Formation TBAC (Tag-Based Access Control)

## Stack Components (One-to-One Mapping with POC)

1. **IAM Stack** (`resources/iam-stack.yml`)
   - Lambda Execution Role
   - Dev User Role (limited access)
   - Super User Role (full access)
   - **Maps to:** `lf-api-key-poc/iam-apikey-stack.yaml`

2. **Lambda + API Stack** (`resources/lambda-api-stack.yml`)
   - DynamoDB Table (API Key mappings with GSI)
   - Lambda Function (Athena query handler)
   - API Gateway (REST API, Methods, Deployment)
   - API Keys (Dev, Super, Analyst)
   - Secrets Manager (API key storage)
   - Custom Resource (API key to DynamoDB mapping)
   - Usage Plans
   - **Maps to:** `lf-api-key-poc/lambda-api-stack.yaml`

3. **Governance Stack** (`resources/governance-stack.yml`)
   - Lake Formation permissions
   - TBAC policies
   - **Maps to:** `lf-api-key-poc/governance-apikey-stack.yaml`

## Prerequisites

```bash
# Install Serverless Framework v3
npm install -g serverless@^3.39.0

# Install dependencies
npm install
```

## Deployment

```bash
# Install dependencies
npm install

# Deploy to dev environment
npm run deploy:dev

# Or using serverless directly with custom region/stage
serverless deploy --stage dev --region ap-southeast-2

# View deployment logs
serverless logs -f athenaQuery --stage dev

# Remove the stack
serverless remove --stage dev
```

## Post-Deployment: Get API Keys

Get API keys:
```bash
aws apigateway get-api-key --api-key <KEY_ID> --include-value --region ap-southeast-2 --query value --output text
```

Test endpoint:
```bash
curl -X POST <API_ENDPOINT>/query \
  -H "x-api-key: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"database":"lf-lh-silver-db-o-sp7-dev","query":"SELECT * FROM member_data LIMIT 3"}'
```

## Configuration

Edit parameters in `serverless.yml`:
- `DatabaseName`: Glue database name
- `AthenaBucketName`: S3 bucket for Athena results
- `AthenaOutputPrefix`: S3 prefix for query results

## Cleanup

```bash
serverless remove --stage dev
```
