# API Key Solution - Visual Guide

## 🎯 Solution Components

```
┌─────────────────────────────────────────────────────────────────────┐
│                    API Key Authentication Solution                   │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐
│  Lambda Code     │  │  Lambda Stack    │  │   API Stack          │
│  (TypeScript)    │  │  (CloudFormation)│  │   (CloudFormation)   │
├──────────────────┤  ├──────────────────┤  ├──────────────────────┤
│ • index.ts       │  │ • Lambda Fn      │  │ • API Gateway        │
│ • apiKeyService  │  │ • IAM Role       │  │ • /query endpoint    │
│ • roleService    │  │ • Log Group      │  │ • API Key auth       │
│ • athenaService  │  │ • Policies       │  │ • Usage Plan         │
│ • errorHandler   │  │                  │  │ • Demo API Key       │
│ • logger         │  │                  │  │                      │
└──────────────────┘  └──────────────────┘  └──────────────────────┘
        ↓                      ↓                      ↓
    Build with            Deploy with            Deploy with
    build.sh          CFN template           CFN template
        ↓                      ↓                      ↓
    lambda.zip       Lambda function         API Gateway
        ↓                      ↓                      ↓
   Upload to S3        Execution role         API endpoint
        ↓                      ↓                      ↓
                    Reference in API stack ──────────┘
```

## 🔄 Request Flow

```
1. CLIENT REQUEST
   │
   │  POST https://abc123.execute-api.us-east-1.amazonaws.com/dev/query
   │  Headers: x-api-key: sk_live_abc123xyz456
   │  Body: {"tableName": "members", "limit": 10}
   │
   ▼
2. API GATEWAY
   │
   ├─► Validate API key exists
   ├─► Check usage plan quota
   ├─► Check rate limits
   │
   ▼
3. LAMBDA INVOCATION
   │
   │  Event: {headers, body, requestContext}
   │
   ▼
4. API KEY SERVICE (apiKeyService.ts)
   │
   ├─► Query DynamoDB: lf-api-key-mappings
   ├─► Key: apiKey = "sk_live_abc123xyz456"
   ├─► Result: {roleArn: "arn:aws:iam::123:role/lf-dev-role"}
   │
   ▼
5. ROLE SERVICE (roleService.ts)
   │
   ├─► AWS STS AssumeRole
   ├─► RoleArn: "arn:aws:iam::123:role/lf-dev-role"
   ├─► SessionName: "athena-query-apikey-session"
   ├─► Result: Temporary credentials (AccessKey, SecretKey, SessionToken)
   │
   ▼
6. ATHENA SERVICE (athenaService.ts)
   │
   ├─► Build SQL: SELECT * FROM "lf-lh-silver-db"."members" LIMIT 10
   ├─► Create Athena client with assumed credentials
   ├─► StartQueryExecution
   ├─► Poll GetQueryExecution (status check)
   ├─► GetQueryResults
   │
   ▼
7. LAKE FORMATION ENFORCEMENT
   │
   ├─► Check role has LF-Tag: DBAccessScope = "silver"
   ├─► Check role has LF-Tag: PII = "false"
   ├─► Filter columns based on tags
   ├─► Return allowed data only
   │
   ▼
8. LAMBDA RESPONSE
   │
   │  {
   │    "success": true,
   │    "query": "SELECT * FROM ...",
   │    "rowCount": 10,
   │    "data": [["id", "name", ...], [...], ...]
   │  }
   │
   ▼
9. API GATEWAY RESPONSE
   │
   │  HTTP 200 OK
   │  Content-Type: application/json
   │  Access-Control-Allow-Origin: *
   │
   ▼
10. CLIENT RECEIVES DATA
```

## 🗂️ File Dependencies

```
deploy-apikey-solution.sh
   │
   ├─► lambdas-ts-apikey/
   │   │
   │   ├─► package.json (defines dependencies)
   │   ├─► tsconfig.json (TypeScript config)
   │   ├─► build.sh (runs npm install, tsc, zip)
   │   │
   │   └─► src/
   │       ├─► index.ts (imports ↓)
   │       │   │
   │       │   ├─► config.ts (env vars)
   │       │   ├─► types.ts (interfaces)
   │       │   ├─► services/apiKeyService.ts
   │       │   ├─► services/roleService.ts
   │       │   ├─► services/athenaService.ts
   │       │   ├─► utils/errorHandler.ts
   │       │   └─► utils/logger.ts
   │       │
   │       └─► Compiled to dist/ → lambda.zip
   │
   ├─► Upload lambda.zip to S3
   │
   ├─► lambda-apikey-stack.yaml
   │   │
   │   ├─► References S3://bucket/lambda.zip
   │   ├─► Creates Lambda function
   │   ├─► Creates IAM role
   │   ├─► Outputs: LambdaFunctionArn
   │
   └─► api-apikey-stack.yaml
       │
       ├─► Parameter: LambdaFunctionArn
       ├─► Creates API Gateway
       ├─► Creates /query endpoint
       ├─► Creates API Key
       └─► Outputs: ApiEndpoint, QueryEndpoint
```

## 🏗️ Stack Dependencies

```
EXISTING INFRASTRUCTURE (Prerequisites)
┌────────────────────────────────────────┐
│ DynamoDB: lf-api-key-mappings          │
│ IAM Role: lf-dev-user-role             │
│ IAM Role: lf-super-user-role           │
│ Glue Database: lf-lh-silver-db         │
│ S3 Bucket: deploymen-bkt               │
└────────────────────────────────────────┘
              ↓ Referenced by
┌────────────────────────────────────────┐
│ LAMBDA STACK                           │
│ Stack: lf-lambda-apikey-dev            │
├────────────────────────────────────────┤
│ Resources:                             │
│  • Lambda Function                     │
│  • Lambda Execution Role               │
│  • CloudWatch Log Group                │
├────────────────────────────────────────┤
│ Outputs:                               │
│  • LambdaFunctionArn ──────────┐       │
│  • LambdaFunctionName          │       │
│  • LambdaRoleArn               │       │
└────────────────────────────────┼───────┘
                                 │
                                 │ Used by
                                 ↓
┌────────────────────────────────────────┐
│ API STACK                              │
│ Stack: lf-api-apikey-dev               │
├────────────────────────────────────────┤
│ Parameters:                            │
│  • LambdaFunctionArn (from above)      │
├────────────────────────────────────────┤
│ Resources:                             │
│  • API Gateway REST API                │
│  • /query Resource                     │
│  • POST Method                         │
│  • Lambda Permission                   │
│  • API Deployment                      │
│  • API Stage                           │
│  • Demo API Key                        │
│  • Usage Plan                          │
├────────────────────────────────────────┤
│ Outputs:                               │
│  • ApiEndpoint                         │
│  • QueryEndpoint                       │
│  • DemoApiKeyId                        │
└────────────────────────────────────────┘
```

## 🔐 IAM Permissions Flow

```
CLIENT
  │
  │ API Key: sk_live_abc123xyz456
  │
  ▼
API GATEWAY
  │
  │ No IAM permissions needed (API key auth)
  │
  ▼
LAMBDA EXECUTION ROLE
  │ arn:aws:iam::123:role/lf-athena-apikey-lambda-role
  │
  ├─► DynamoDB Read Permission
  │   └─► GetItem on lf-api-key-mappings
  │
  ├─► STS AssumeRole Permission
  │   ├─► Assume lf-dev-user-role
  │   └─► Assume lf-super-user-role
  │
  ├─► Athena Permissions
  │   ├─► StartQueryExecution
  │   ├─► GetQueryExecution
  │   └─► GetQueryResults
  │
  ├─► S3 Permissions
  │   ├─► GetObject on aws-athena-query-results-*
  │   └─► PutObject on aws-athena-query-results-*
  │
  └─► Glue Permissions
      ├─► GetDatabase
      ├─► GetTable
      └─► GetPartitions
          │
          ▼
ASSUMED ROLE (from DynamoDB lookup)
  │ arn:aws:iam::123:role/lf-dev-user-role
  │
  └─► Lake Formation Tags
      ├─► DBAccessScope = "silver"
      └─► PII = "false"
          │
          ▼
LAKE FORMATION
  │
  ├─► Check: User has DBAccessScope tag?
  ├─► Check: DBAccessScope matches database tag?
  ├─► Check: User has PII=false tag?
  ├─► Filter: Hide columns with PII=true tag
  │
  ▼
ATHENA QUERY EXECUTION
  │
  └─► Returns filtered results
```

## 📊 Data Flow

```
DynamoDB Table: lf-api-key-mappings
┌────────────────────────────────────────┐
│ apiKey (PK)        │ roleArn            │
├────────────────────┼────────────────────┤
│ sk_live_abc123     │ arn:aws:iam::123:  │
│                    │ role/lf-dev-role   │
├────────────────────┼────────────────────┤
│ sk_live_xyz789     │ arn:aws:iam::123:  │
│                    │ role/lf-super-role │
└────────────────────┴────────────────────┘
         ↓ Lookup
IAM Role: lf-dev-user-role
┌────────────────────────────────────────┐
│ LF-Tags:                               │
│  • DBAccessScope = "silver"            │
│  • PII = "false"                       │
└────────────────────────────────────────┘
         ↓ AssumeRole
Temporary Credentials
┌────────────────────────────────────────┐
│ • AccessKeyId: ASIA...                 │
│ • SecretAccessKey: wJalr...            │
│ • SessionToken: FwoGZ...               │
│ • Expiration: 2026-01-29T15:30:00Z     │
└────────────────────────────────────────┘
         ↓ Used for
Athena Query
┌────────────────────────────────────────┐
│ SELECT * FROM "lf-lh-silver-db"."members" LIMIT 10
│
│ Lake Formation checks:
│  ✓ Role has DBAccessScope="silver"
│  ✓ Database has DBAccessScope="silver"
│  ✓ Column 'ssn' has PII="true" → HIDE
│  ✓ Column 'id' has no PII tag → SHOW
│  ✓ Column 'name' has no PII tag → SHOW
└────────────────────────────────────────┘
         ↓ Returns
Query Results
┌────────────────────────────────────────┐
│ [                                      │
│   ["id", "name", "email"],             │
│   ["1", "John", "john@example.com"],   │
│   ["2", "Jane", "jane@example.com"]    │
│ ]                                      │
│                                        │
│ Note: 'ssn' column filtered out        │
└────────────────────────────────────────┘
```

## 🧩 Service Layer Architecture

```
index.ts (Handler)
    │
    ├─► extractApiKey(event)
    │   └─► Returns: "sk_live_abc123"
    │
    ├─► parseBody(event)
    │   └─► Returns: {tableName: "members", limit: 10}
    │
    ├─► ApiKeyService.getRoleForApiKey()
    │   │
    │   └─► DynamoDB GetItem
    │       └─► Returns: "arn:aws:iam::123:role/lf-dev-role"
    │
    ├─► RoleService.assumeRole()
    │   │
    │   └─► STS AssumeRole
    │       └─► Returns: {accessKeyId, secretAccessKey, sessionToken}
    │
    └─► AthenaService.executeQuery()
        │
        ├─► startQuery()
        │   └─► StartQueryExecution
        │       └─► Returns: queryExecutionId
        │
        ├─► waitForQueryCompletion()
        │   └─► GetQueryExecution (polling)
        │       └─► Returns: SUCCEEDED status
        │
        └─► getQueryResults()
            └─► GetQueryResults
                └─► Returns: [["id", "name"], ["1", "John"], ...]
```

## 📝 Environment Variables

```
Lambda Function Environment
┌─────────────────────────────────────────────────┐
│ API_KEY_TABLE         = "lf-api-key-mappings"   │
│ DATABASE_NAME         = "lf-lh-silver-db"       │
│ ATHENA_OUTPUT_BUCKET  = "s3://aws-athena-..."   │
│ REGION                = "us-east-1"             │
│ LOG_LEVEL             = "INFO"                  │
└─────────────────────────────────────────────────┘
         ↓ Read by
    config.ts (getConfig())
         ↓ Used by
All services (apiKeyService, roleService, athenaService)
```

## 🎨 Code Organization Philosophy

```
SEPARATION OF CONCERNS

Handler (index.ts)
  ↓ Orchestrates workflow
Services (services/*.ts)
  ↓ Business logic
Utils (utils/*.ts)
  ↓ Cross-cutting concerns
AWS SDKs
  ↓ Infrastructure interaction
AWS Resources
```

## ✅ Deployment Checklist

```
□ 1. Prerequisites exist
   □ DynamoDB table: lf-api-key-mappings
   □ IAM roles: lf-dev-user-role, lf-super-user-role
   □ Glue database: lf-lh-silver-db
   □ S3 bucket: deploymen-bkt

□ 2. Build Lambda
   □ cd lambdas-ts-apikey
   □ npm install
   □ bash build.sh
   □ Verify lambda.zip created

□ 3. Run deployment script
   □ cd ..
   □ ./deploy-apikey-solution.sh dev deploymen-bkt us-east-1
   □ Enter required parameters when prompted

□ 4. Verify stacks
   □ Check CloudFormation: lf-lambda-apikey-dev
   □ Check CloudFormation: lf-api-apikey-dev
   □ Review outputs

□ 5. Test endpoint
   □ Run test-apikey-solution.sh
   □ Or manual curl test
   □ Check CloudWatch logs

□ 6. Production setup
   □ Create real API key mappings in DynamoDB
   □ Configure usage plan limits
   □ Set up CloudWatch alarms
   □ Enable API Gateway logging
```

---

**All diagrams created! The solution is complete and ready to deploy.** 🎉
