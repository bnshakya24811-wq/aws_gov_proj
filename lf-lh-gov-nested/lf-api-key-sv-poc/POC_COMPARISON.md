# lf-api-key-poc vs lf-api-key-sv-poc - Complete Comparison

## Executive Summary

✅ **The serverless implementation (lf-api-key-sv-poc) is now FULLY COMPATIBLE with the original CloudFormation POC (lf-api-key-poc)**

All functionality has been preserved and properly adapted to Serverless Framework v3.

---

## Side-by-Side Comparison

### Architecture Overview

| Aspect | Original POC | Serverless POC |
|--------|-------------|----------------|
| **Deployment** | CloudFormation / SAM CLI | Serverless Framework v3 |
| **Lambda Language** | Python | TypeScript |
| **Lambda Code** | Single file (246 lines) | Modular (services/, utils/) |
| **Build Process** | Manual zip + S3 upload | Automatic via serverless-plugin-typescript |
| **API Gateway** | Manual CFN resources | Managed by framework |
| **Stacks** | 3 separate stacks | 3 resource files, 1 deployment |

### Core Components Comparison

#### 1. Lambda Function

**Original (Python):**
```python
# index.py or lambda-handler.py
def handler(event, context):
    # Extract API key from headers
    # List secrets, find match
    # Query DynamoDB for role
    # Assume role
    # Execute Athena query
```

**Serverless (TypeScript):**
```typescript
// src/index.ts
export const handler = async (event, context) => {
  // Same flow, modular services:
  // - apiKeyAuthService.authenticate()
  // - roleService.assumeRole()
  // - athenaService.executeQuery()
}
```

**Status:** ✅ Functionally identical, TypeScript version more maintainable

---

#### 2. DynamoDB Table

| Property | Original | Serverless | Match |
|----------|----------|------------|-------|
| Table Name | `lf-apikey-mappings-v3-{env}` | Same | ✅ |
| Key Schema | secretName (HASH) | Same | ✅ |
| GSI | GroupLabelIndex | Same | ✅ |
| Attributes | secretName, groupLabel, roleArn, userName | Same | ✅ |

**Status:** ✅ 100% identical

---

#### 3. IAM Roles

**Lambda Execution Role:**
```yaml
# Both versions identical
Policies:
  - SecretsManagerAccess (GetSecretValue, ListSecrets)
  - AthenaAccess (StartQuery, GetResults)
  - S3Access (Athena output bucket)
  - GlueAccess (GetDatabase, GetTable)
  - AssumeRoles (Dev + Super user roles)
  - DynamoDBAccess (GetItem)
```

**LF Dev User Role:**
```yaml
# Both versions identical
Policies:
  - S3: Get/List (limited)
  - Glue: Read-only
  - Athena: Query execution
  - LakeFormation: GetDataAccess
```

**LF Super User Role:**
```yaml
# Both versions identical  
Policies:
  - S3: Full access
  - Glue: Full access
  - Athena: Full access
  - LakeFormation: Full access
```

**Status:** ✅ 100% identical

---

#### 4. Lake Formation Permissions

| Aspect | Original | Serverless (After Fix) | Match |
|--------|----------|----------------------|-------|
| **Tag: DBAccessScope** | `DBAccessScope-o-sp7-{env}` | Same ✅ | ✅ |
| **Tag: PII** | `PII` | Same ✅ | ✅ |
| **Dev User - Database** | DESCRIBE on silver | Same | ✅ |
| **Dev User - Tables** | SELECT, DESCRIBE on non-PII (PII=false) | Same | ✅ |
| **Super User - Database** | ALL on silver | Same ✅ | ✅ |
| **Super User - Tables** | ALL on all columns (PII=*) | Same ✅ | ✅ |

**Status:** ✅ 100% identical after fix

---

#### 5. API Gateway

**Original (Manual CloudFormation):**
```yaml
AthenaQueryAPI (RestApi)
  ├── QueryResource (/query)
  │   ├── POST (ApiKeyRequired: true)
  │   └── OPTIONS (CORS)
  ├── Deployment
  ├── Stage (dev/prod)
  └── API Keys (Dev, Super, Analyst)
      └── Usage Plans
```

**Serverless (Framework-managed):**
```yaml
functions:
  athenaQuery:
    events:
      - http:
          path: query
          method: post
          private: true  # API key required
          cors: true

# Framework auto-creates: RestApi, Resources, Methods, Deployment, Stage
# CloudFormation adds: API Keys, Usage Plans
```

**Status:** ✅ Equivalent (Serverless approach cleaner)

---

#### 6. Custom Resource (API Key Storage)

**Flow (Both versions identical):**
1. CloudFormation triggers custom resource Lambda
2. Lambda retrieves API key values from API Gateway
3. Stores each key in Secrets Manager with metadata
4. Creates DynamoDB mapping: secretName → roleArn
5. Tags secrets with `LFAPIKeyType` for scanning

**Original:** Separate Lambda function defined in CFN  
**Serverless:** Defined in `functions:` section, referenced by CFN custom resource

**Status:** ✅ Same logic, different deployment method

---

## File-by-File Mapping

| Original POC | Serverless POC | Purpose |
|-------------|----------------|---------|
| `lambda-handler.py` or `index.py` | `src/index.ts` | Main Lambda handler |
| N/A | `src/services/*.ts` | Modular service layer |
| N/A | `src/utils/*.ts` | Utilities (logging, errors) |
| `iam-apikey-stack.yaml` | `resources/iam-stack.yml` | IAM roles |
| `lambda-api-stack.yaml` | `resources/lambda-api-stack.yml` | DynamoDB, API keys |
| `governance-apikey-stack.yaml` | `resources/governance-stack.yml` | LF permissions |
| `main-apikey.yaml` | `serverless.yml` | Main orchestration |
| N/A | `package.json` | Dependencies & scripts |
| N/A | `tsconfig.json` | TypeScript config |

---

## Key Improvements in Serverless Version

### 1. Developer Experience
- ✅ **Single command deployment**: `npm run deploy:dev`
- ✅ **Automatic TypeScript compilation**: No manual build steps
- ✅ **Built-in logging**: `serverless logs -f athenaQuery`
- ✅ **Local testing**: `serverless offline`
- ✅ **Easy removal**: `serverless remove --stage dev`

### 2. Code Quality
- ✅ **Modular architecture**: Separate services for each concern
- ✅ **Type safety**: TypeScript prevents runtime errors
- ✅ **Better error handling**: Consistent error responses
- ✅ **Reusable services**: Can be extracted for other projects

### 3. Infrastructure as Code
- ✅ **Less boilerplate**: Framework handles API Gateway, deployments
- ✅ **Stage management**: Built-in support for dev/staging/prod
- ✅ **Resource naming**: Automatic with stage suffix
- ✅ **Stack outputs**: Automatically captured

### 4. Maintenance
- ✅ **Clearer separation**: Functions vs resources
- ✅ **Easier updates**: Change function code without touching CFN
- ✅ **Version control**: All config in one place (serverless.yml)

---

## Deployment Comparison

### Original POC Deployment
```bash
# Build Lambda package
cd lambda-code
zip -r ../athena-query-apikey.zip .

# Upload to S3
aws s3 cp athena-query-apikey.zip s3://bucket/lambda/

# Deploy IAM stack
aws cloudformation deploy --template-file iam-apikey-stack.yaml \
  --stack-name lf-iam-stack --parameter-overrides Environment=dev

# Deploy Lambda/API stack (wait for IAM)
aws cloudformation deploy --template-file lambda-api-stack.yaml \
  --stack-name lf-api-stack --parameter-overrides \
  Environment=dev \
  LambdaExecutionRoleArn=... \
  LFDevUserArn=... \
  LFSuperUserArn=...

# Deploy governance stack (wait for API)
aws cloudformation deploy --template-file governance-apikey-stack.yaml \
  --stack-name lf-gov-stack --parameter-overrides \
  Environment=dev \
  LFDevUserRoleArn=... \
  LFSuperUserRoleArn=...
```

### Serverless POC Deployment
```bash
# Install dependencies (once)
npm install

# Deploy everything
npm run deploy:dev

# Or with custom options
serverless deploy --stage dev --region ap-southeast-2
```

**Winner:** ✅ Serverless (much simpler)

---

## Testing Comparison

### Get API Key
**Original:**
```bash
aws apigateway get-api-key --api-key <ID> --include-value --query value --output text
```

**Serverless:** Same command ✅

### Invoke API
**Both versions:**
```bash
curl -X POST <API_ENDPOINT>/query \
  -H "x-api-key: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "database": "lf-lh-silver-db-o-sp7-dev",
    "query": "SELECT * FROM member_data LIMIT 3"
  }'
```

**Status:** ✅ Identical

---

## Migration Checklist

If migrating from original POC to Serverless:

- [x] Lambda code rewritten in TypeScript with same logic
- [x] IAM roles match exactly
- [x] DynamoDB table schema identical
- [x] Lake Formation tag names match (`DBAccessScope-o-sp7-{env}`, `PII`)
- [x] Lake Formation permissions identical
- [x] API Gateway configuration equivalent
- [x] Custom resource logic preserved
- [x] Environment variables mapped correctly
- [x] Deployment process simplified
- [x] Testing procedures compatible

---

## Verdict

### ✅ **100% Feature Parity Achieved**

The serverless implementation:
1. ✅ Preserves all functionality from the original POC
2. ✅ Uses the same Lake Formation tags (no re-tagging needed)
3. ✅ Provides identical IAM roles and permissions
4. ✅ Maintains the same authentication flow
5. ✅ Works with existing databases and tables
6. ✅ Improves developer experience significantly
7. ✅ Easier to maintain and extend

### Recommendation

**Use lf-api-key-sv-poc for:**
- ✅ New deployments
- ✅ Rapid development/testing
- ✅ Multi-environment setups (dev/staging/prod)
- ✅ Teams familiar with Serverless Framework
- ✅ Projects requiring frequent updates

**Keep lf-api-key-poc for:**
- Reference implementation
- Organizations using pure CloudFormation/SAM
- Understanding the core concepts

---

## Quick Reference

| Task | Command |
|------|---------|
| **Deploy** | `npm run deploy:dev` |
| **View Logs** | `serverless logs -f athenaQuery --tail` |
| **Get Outputs** | `serverless info` |
| **Remove Stack** | `serverless remove --stage dev` |
| **Validate Config** | `serverless print` |
| **Package Only** | `serverless package` |

---

**Status:** ✅ Production Ready  
**Compatibility:** ✅ 100% with original POC  
**Tested:** ✅ All components verified
