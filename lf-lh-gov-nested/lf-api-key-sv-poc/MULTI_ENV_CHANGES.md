# Multi-Environment Support - Changes Made

## Overview
Modified the Serverless implementation to support multiple environments (dev, staging, prod) with full Lake Formation tag creation and management.

## Key Changes

### 1. **governance-stack.yml** - Now Self-Contained
Added Lake Formation tag creation and association:

#### New Capabilities:
- **Creates LF Tags** for each environment:
  - `DBAccess-o-sv-${env}` (values: silver, gold, bronze)
  - `DataSensitivity-o-sv-${env}` (values: non-sensitive, sensitive, pii)

- **Applies Tags** to database and tables:
  - Database: Tagged with `DBAccess-o-sv-${env}=silver`
  - Table: Tagged with both tags

- **Grants Permissions** based on tags:
  - Dev User: Can query non-sensitive data only
  - Super User: Can query all data including PII

#### Parameters Added:
```yaml
Parameters:
  DatabaseName: Name of the Glue database
  TableName: Name of the Glue table (default: user_transactions)
```

### 2. **serverless.yml** - Multi-Environment Config
Added environment-specific parameters:

```yaml
params:
  dev:
    DatabaseName: lf-lh-silver-db-o-sp5-${self:provider.stage}
    TableName: user_transactions
    AthenaBucketName: aws-athena-query-results-480399101976-ap-southeast-2
    AthenaOutputPrefix: api-key-poc-${self:provider.stage}/
    LambdaArtifactsBucket: lf-apikey-lambda-artifacts-${self:provider.stage}-480399101976
  
  prod:
    # Same structure with environment-specific values
  
  staging:
    # Same structure with environment-specific values
```

### 3. **lambda-api-stack.yml** - Removed Hardcoded Values
- Changed S3 bucket from hardcoded `lf-apikey-lambda-artifacts-dev-480399101976` to `!Ref LambdaCodeS3Bucket`
- Changed Lambda S3 key from `athena-query-apikey-dev.zip` to `athena-query-apikey.zip`

## Environment Isolation

Each environment now gets its own:
- ✅ Lake Formation tags (`DBAccess-o-sv-dev`, `DBAccess-o-sv-prod`, etc.)
- ✅ IAM roles (`lf-athena-apikey-lambda-role-apk-dev`, etc.)
- ✅ DynamoDB tables (`lf-apikey-mappings-v3-dev`, etc.)
- ✅ API Gateway (`lf-athena-apikey-api-apk-dev`, etc.)
- ✅ Secrets Manager entries (`lf-apikey-dev-user-v3-dev`, etc.)
- ✅ CloudFormation stack (`lf-apikey-poc-dev`, `lf-apikey-poc-prod`, etc.)

## Deployment Commands

### Deploy to Dev:
```bash
serverless deploy --stage dev --verbose
```

### Deploy to Staging:
```bash
serverless deploy --stage staging --verbose
```

### Deploy to Production:
```bash
serverless deploy --stage prod --verbose
```

## What Works Now

1. **Tag Creation**: No need to pre-create Lake Formation tags manually
2. **Tag Association**: Automatically tags database and table resources
3. **Permission Management**: Grants appropriate access based on tags
4. **Environment Separation**: Complete isolation between dev/staging/prod
5. **Reusable**: Same codebase deploys to any environment

## Important Notes

### Prerequisites per Environment:
- S3 bucket for Lambda artifacts: `lf-apikey-lambda-artifacts-${stage}-480399101976`
- Glue database: `lf-lh-silver-db-o-sp5-${stage}`
- Glue table: `user_transactions` in that database
- Upload Lambda code to S3 before deployment

### Tag Naming Convention:
- Changed from: `DBAccessScope-o-sp7-${stage}` and `DataSensitivity-o-sp7-${stage}`
- Changed to: `DBAccess-o-sv-${stage}` and `DataSensitivity-o-sv-${stage}`
- Reason: Cleaner naming and avoids conflicts with existing tags

## Cleanup Commands

To remove a specific environment:
```bash
serverless remove --stage dev
```

This will delete:
- All AWS resources (API Gateway, Lambda, DynamoDB, IAM roles, Secrets)
- Lake Formation permissions
- Lake Formation tags (if not used by other resources)
