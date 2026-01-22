# Lake Formation Nested Serverless - Hybrid Approach

## Overview

This implementation combines **Serverless Framework** for deployment convenience with **CloudFormation Nested Stacks** for governance modularity. It demonstrates a hybrid architecture where:

- **Stack 0 & 1**: Simple Serverless stacks (tags and resources)
- **Stack 2**: Serverless orchestrator deploying CloudFormation nested stacks (governance/permissions)
- **Cross-stack communication**: SSM Parameter Store (no Import/Export constraints)
- **Multi-environment support**: Environment-specific resources with `-o-sp6-${stage}` suffix
- **Shared governance**: Lake Formation tags are environment-agnostic

## Architecture

```
lf-lh-gov-nested-serverless/
├── stack-0-lf-tags/              # Serverless: Creates LF tags
│   └── serverless.yml            # DBAccessScope-o-sp6, PII-o-sp6
│
├── stack-1-resources/            # Serverless: IAM, Glue, S3
│   └── serverless.yml            # Users, roles, database, bucket, crawler
│
└── stack-2-permissions/          # Serverless + Nested CloudFormation
    ├── serverless.yml            # Orchestrator: deploys nested stacks
    ├── nested/
    │   ├── tag-associations-stack.yaml  # Nested: Tag associations
    │   └── permissions-stack.yaml       # Nested: LF permissions
    └── upload-templates.sh       # Utility: Upload nested templates to S3
```

## Key Features

✅ **Serverless deployment workflow** - `serverless deploy` commands  
✅ **Nested stack modularity** - Governance split into tag associations + permissions  
✅ **SSM cross-stack references** - No deletion dependencies  
✅ **Multi-environment** - Deploy dev, staging, prod in same account  
✅ **Environment isolation** - Resources suffixed with `-o-sp6-${stage}`  
✅ **Shared LF tags** - `DBAccessScope-o-sp6`, `PII-o-sp6` (no environment suffix)  
✅ **No plugins required** - Pure Serverless + CloudFormation

## Deployment Order

### Prerequisites

```bash
# Install Serverless Framework globally
npm install -g serverless

# Set AWS credentials
export AWS_PROFILE=your-profile
```

### Step 1: Deploy Stack 0 (LF Tags)

```bash
cd stack-0-lf-tags

serverless deploy --stage dev --region us-east-1
```

**Creates:**
- Lake Formation tags: `DBAccessScope-o-sp6`, `PII-o-sp6`
- SSM parameters: `/lf-lh/dev/tags/*`

### Step 2: Deploy Stack 1 (Resources)

```bash
cd ../stack-1-resources

serverless deploy --stage dev --region us-east-1
```

**Creates:**
- IAM users: `lf-lh-dev-user-o-sp6-dev`, `lf-lh-super-user-o-sp6-dev`
- IAM roles: `lf-lh-glue-crawler-role-o-sp6-dev`, `lf-lh-glue-job-role-o-sp6-dev`
- S3 bucket: `lf-lh-silver-bkt-o-sp6-dev`
- Glue database: `lf-lh-silver-db-o-sp6-dev`
- Glue crawler: `lf-lh-silver-crawler-o-sp6-dev`
- SSM parameters: `/lf-lh/dev/resources/*`

**Wait time:** ~3-5 minutes

### Step 3: Upload Nested Templates

```bash
cd ../stack-2-permissions

chmod +x upload-templates.sh
./upload-templates.sh dev us-east-1
```

**Creates S3 bucket and uploads:**
- `s3://lf-nested-templates-o-sp6-dev/nested/tag-associations-stack.yaml`
- `s3://lf-nested-templates-o-sp6-dev/nested/permissions-stack.yaml`

### Step 4: Deploy Stack 2 (Governance with Nested Stacks)

```bash
serverless deploy --stage dev --region us-east-1
```

**Creates:**
1. Serverless stack: `lf-lh-stack-2-permissions-o-sp6-dev`
2. Nested stack 1: Tag associations (associates `DBAccessScope-o-sp6=silver` with database)
3. Nested stack 2: Permissions (grants LF permissions to users/roles)

**Wait time:** ~10-15 minutes

## Multi-Environment Deployment

Deploy to multiple environments independently:

```bash
# Deploy dev environment
./deploy-all.sh dev us-east-1

# Deploy staging environment (parallel - no conflicts)
./deploy-all.sh staging us-east-1

# Deploy prod environment
./deploy-all.sh prod us-east-1
```

### Environment Isolation

Each environment gets isolated resources:

| Resource | Dev | Staging | Prod |
|----------|-----|---------|------|
| **Database** | lf-lh-silver-db-o-sp6-dev | lf-lh-silver-db-o-sp6-staging | lf-lh-silver-db-o-sp6-prod |
| **Bucket** | lf-lh-silver-bkt-o-sp6-dev | lf-lh-silver-bkt-o-sp6-staging | lf-lh-silver-bkt-o-sp6-prod |
| **Dev User** | lf-lh-dev-user-o-sp6-dev | lf-lh-dev-user-o-sp6-staging | lf-lh-dev-user-o-sp6-prod |
| **SSM Path** | /lf-lh/dev/* | /lf-lh/staging/* | /lf-lh/prod/* |

**LF Tags (shared):** `DBAccessScope-o-sp6`, `PII-o-sp6`

## Post-Deployment Steps

### 1. Revoke IAMAllowedPrincipals

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

aws lakeformation batch-revoke-permissions \
  --entries "[{
    \"Id\": \"1\",
    \"Principal\": {\"DataLakePrincipalIdentifier\": \"IAMAllowedPrincipals\"},
    \"Resource\": {\"Database\": {\"CatalogId\": \"${ACCOUNT_ID}\", \"Name\": \"lf-lh-silver-db-o-sp6-dev\"}},
    \"Permissions\": [\"ALL\"]
  }]" \
  --region us-east-1
```

### 2. Upload Test Data

```bash
aws s3 cp ../../silver_members.csv s3://lf-lh-silver-bkt-o-sp6-dev/members/
aws s3 cp ../../user_transactions.csv s3://lf-lh-silver-bkt-o-sp6-dev/transactions/
```

### 3. Run Glue Crawler

```bash
aws glue start-crawler --name lf-lh-silver-crawler-o-sp6-dev --region us-east-1
```

### 4. Tag PII Columns

```bash
python ../../tag_column_as_pii.py \
  --db lf-lh-silver-db-o-sp6-dev \
  --table members \
  --column ssn \
  --tag-key PII-o-sp6 \
  --tag-value true
```

## How It Works

### Cross-Stack Communication via SSM

```yaml
# Stack 1 writes to SSM
DatabaseNameSSM:
  Type: AWS::SSM::Parameter
  Properties:
    Name: /lf-lh/${stage}/resources/database-name
    Value: !Ref LFLHSilverDB

# Stack 2 reads from SSM (resolved at deploy time)
Parameters:
  DatabaseName: ${ssm:/lf-lh/dev/resources/database-name}
```

### Nested Stack Pattern in Serverless

```yaml
# serverless.yml
resources:
  Resources:
    TagAssociationsNestedStack:
      Type: AWS::CloudFormation::Stack
      Properties:
        TemplateURL: !Sub https://${bucket}.s3.amazonaws.com/nested/tag-associations-stack.yaml
        Parameters:
          DatabaseName: ${ssm:/lf-lh/dev/resources/database-name}
```

**Benefits:**
1. Serverless manages parent stack lifecycle
2. CloudFormation manages nested stack dependencies
3. SSM enables loose coupling between stacks
4. No Import/Export deletion constraints

## Update Workflow

### Update Stack 0 or 1 (Simple)

```bash
cd stack-1-resources
serverless deploy --stage dev --region us-east-1
```

Changes propagate via SSM automatically (serverless resolves SSM at deploy time).

### Update Stack 2 Nested Templates

```bash
cd stack-2-permissions

# 1. Modify nested templates
vim nested/permissions-stack.yaml

# 2. Upload updated templates
./upload-templates.sh dev us-east-1

# 3. Redeploy stack-2 (detects template changes via S3 URL)
serverless deploy --stage dev --region us-east-1
```

CloudFormation detects S3 template changes and updates only affected nested stacks.

## Stack Removal

### Remove Specific Environment

```bash
# Remove in reverse order
cd stack-2-permissions
serverless remove --stage dev --region us-east-1

cd ../stack-1-resources
serverless remove --stage dev --region us-east-1

cd ../stack-0-lf-tags
serverless remove --stage dev --region us-east-1
```

**Note:** Empty S3 buckets before removal:
```bash
aws s3 rm s3://lf-lh-silver-bkt-o-sp6-dev --recursive
aws s3 rm s3://lf-nested-templates-o-sp6-dev --recursive
```

### Remove All Environments

```bash
for stage in dev staging prod; do
  echo "Removing ${stage} environment..."
  cd stack-2-permissions && serverless remove --stage ${stage}
  cd ../stack-1-resources && serverless remove --stage ${stage}
  cd ../stack-0-lf-tags && serverless remove --stage ${stage}
  cd ..
done
```

## Advantages of This Hybrid Approach

| Feature | Serverless Only | Pure CloudFormation Nested | This Hybrid Approach |
|---------|----------------|---------------------------|---------------------|
| **Deployment tool** | `serverless deploy` | `aws cloudformation deploy` | `serverless deploy` ✅ |
| **Stage isolation** | Built-in | Manual parameters | Built-in ✅ |
| **SSM resolution** | Native `${ssm:...}` | Verbose `{{resolve:ssm}}` | Native ✅ |
| **Nested stack modularity** | Manual CloudFormation | Native | Native ✅ |
| **Plugin support** | ✅ | ❌ | ✅ |
| **Deletion constraints** | Independent stacks | Parent manages | No constraints ✅ |
| **Governance modularity** | Single serverless.yml | Separate YAML files | Separate YAML files ✅ |

## Troubleshooting

### Error: "SSM parameter not found"

**Cause:** Stack 1 hasn't deployed yet or wrong stage  
**Solution:** Deploy stack-0 and stack-1 first

### Error: "Template URL must point to S3"

**Cause:** Nested templates not uploaded  
**Solution:** Run `./upload-templates.sh dev`

### Error: "Grantee has no permissions"

**Cause:** IAMAllowedPrincipals already revoked (expected)  
**Solution:** Warning is normal after first deployment

### Nested stack stuck in CREATE_IN_PROGRESS

**Cause:** Lake Formation permission conflict  
**Solution:** Check CloudFormation events for specific resource failure

## Comparison with Other POC Approaches

| Approach | Location | Pattern | Use Case |
|----------|----------|---------|----------|
| **Pure CloudFormation** | `cfn/` | Monolithic + Split | Learning CloudFormation |
| **Serverless Split** | `lf-lh-gov-serverless-split/` | Import/Export | Simple multi-stack |
| **Serverless SSM** | `lf-lh-gov-serveress-ssm/` | SSM parameters | Flexible coupling |
| **Pure Nested** | `lf-lh-gov-nested/` | CloudFormation nested | Production atomicity |
| **Nested Serverless** | `lf-lh-gov-nested-serverless/` | Hybrid | Best of both worlds ✅ |

**This approach (nested-serverless) is ideal for:**
- Teams familiar with Serverless Framework
- Need nested stack modularity for governance
- Want environment isolation without complexity
- Require independent stack lifecycle management
