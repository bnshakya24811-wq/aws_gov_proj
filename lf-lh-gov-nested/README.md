# Lake Formation Nested Stacks - Access Control POC

## Overview

This implementation uses AWS CloudFormation **nested stacks** to deploy Lake Formation Tag-Based Access Control (TBAC) infrastructure with **multi-environment support**. The nested stack approach provides better organization, reusability, and clearer separation of concerns compared to monolithic templates.

**Key Features:**
- ✅ Multi-environment deployments (dev, staging, prod) in same account
- ✅ Resource naming with `-o-sp5-${Environment}` suffix to avoid conflicts
- ✅ Environment-agnostic Lake Formation tags (shared across all environments)
- ✅ Single deployment command per environment
- ✅ Automatic dependency management and rollback

## Architecture

### Stack Hierarchy

```
main.yaml (Master Stack)
├── iam-stack.yaml (IAM Users, Roles, Policies)
├── glue-stack.yaml (Glue Database, S3 Bucket, Crawler)
└── governance-stack.yaml (Lake Formation Tags & Permissions)
```

### Deployment Dependencies

The stacks are deployed in a specific order with dependencies:

1. **IAM Stack** (independent) → Creates IAM users, roles, and policies
2. **Glue Stack** (depends on IAM) → Uses GlueCrawlerRoleArn from IAM stack
3. **Governance Stack** (depends on IAM + Glue) → Uses ARNs and database name from both

### Resource Distribution

#### IAM Stack (`iam-stack.yaml`)
- **IAM Users**: `lf-lh-dev-user-o-sp5-${Environment}`, `lf-lh-super-user-o-sp5-${Environment}`
- **Access Keys**: For both users
- **IAM Policies**: Glue, S3, Athena permissions (suffixed per environment)
- **IAM Roles**: `lf-lh-glue-crawler-role-o-sp5-${Environment}`, `lf-lh-glue-job-role-o-sp5-${Environment}`

**Exports**:
- `LFDevUserArn`
- `LFSuperUserArn`
- `GlueCrawlerRoleArn`
- `GlueJobRoleArn`
- Access keys (sensitive)

#### Glue Stack (`glue-stack.yaml`)
- **S3 Bucket**: `lf-lh-silver-bkt-o-sp5-${Environment}`
- **Glue Database**: `lf-lh-silver-db-o-sp5-${Environment}`
- **Glue Crawler**: `lf-lh-silver-crawler-o-sp5-${Environment}`

**Exports**:
- `DatabaseName`
- `BucketName`
- `CrawlerName`

#### Governance Stack (`governance-stack.yaml`)
- **Lake Formation Tags** (shared, no environment suffix): 
  - `DBAccessScope-o-sp5` (values: silver, gold)
  - `PII-o-sp5` (values: true, false)
- **Tag Associations**: Associates `DBAccessScope-o-sp5=silver` with environment-specific database
- **LF Permissions**: Tag-based policies for environment-specific users and roles

**Exports**:
- `DBAccessScopeTagKey` (DBAccessScope-o-sp5)
- `PIITagKey` (PII-o-sp5)

## Deployment Instructions

### Prerequisites

1. **S3 Bucket for Templates**: Create an S3 bucket to host nested stack templates
   ```bash
   aws s3 mb s3://your-cloudformation-templates-bucket
   ```

2. **Upload Nested Stack Templates**:
   ```bash
   aws s3 cp iam-stack.yaml s3://your-cloudformation-templates-bucket/lf-nested-stacks/
   aws s3 cp glue-stack.yaml s3://your-cloudformation-templates-bucket/lf-nested-stacks/
   aws s3 cp governance-stack.yaml s3://your-cloudformation-templates-bucket/lf-nested-stacks/
   ```

### Deploy Master Stack (Per Environment)

#### Option 1: Using Deployment Script

```bash
# Make script executable
chmod +x deploy-example.sh

# Deploy dev environment
./deploy-example.sh dev

# Deploy staging environment
./deploy-example.sh staging

# Deploy prod environment
./deploy-example.sh prod
```

#### Option 2: Manual Deployment

```bash
# Deploy to dev environment
aws cloudformation deploy \
  --stack-name lf-lh-master-stack-o-sp5-dev \
  --template-file main.yaml \
  --parameter-overrides \
    TemplateS3Bucket=your-cloudformation-templates-bucket \
    TemplateS3Prefix=lf-nested-stacks \
    Environment=dev \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1

# Deploy to staging environment (parallel deployment - no conflicts)
aws cloudformation deploy \
  --stack-name lf-lh-master-stack-o-sp5-staging \
  --template-file main.yaml \
  --parameter-overrides \
    Environment=staging \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1
```

### Multi-Environment Architecture

Each environment gets its own isolated resources:

```
Account: 123456789012
├── dev environment
│   ├── IAM: lf-lh-dev-user-o-sp5-dev
│   ├── IAM: lf-lh-super-user-o-sp5-dev
│   ├── S3: lf-lh-silver-bkt-o-sp5-dev
│   ├── Glue DB: lf-lh-silver-db-o-sp5-dev
│   └── Crawler: lf-lh-silver-crawler-o-sp5-dev
├── staging environment
│   ├── IAM: lf-lh-dev-user-o-sp5-staging
│   ├── S3: lf-lh-silver-bkt-o-sp5-staging
│   └── ... (all resources suffixed with -staging)
└── Shared Lake Formation Tags (no environment suffix)
    ├── DBAccessScope-o-sp5: [silver, gold]
    └── PII-o-sp5: [true, false]
```

**Note**: Lake Formation tags are shared across all environments. Only the tag *associations* to databases/tables are environment-specific.

### Monitor Deployment

```bash
# For dev environment
aws cloudformation describe-stacks \
  --stack-name lf-lh-master-stack-o-sp5-dev \
  --query 'Stacks[0].StackStatus'

# View nested stack events
aws cloudformation describe-stack-events \
  --stack-name lf-lh-master-stack-o-sp5-dev
```

### Retrieve Outputs

```bash
# Get all outputs for dev environment
aws cloudformation describe-stacks \
  --stack-name lf-lh-master-stack-o-sp5-dev \
  --query 'Stacks[0].Outputs'
```

## Post-Deployment Steps

### 1. Revoke IAMAllowedPrincipals

After deployment, revoke default IAM permissions from the database to enforce Lake Formation TBAC:

```bash
# For dev environment
aws lakeformation batch-revoke-permissions \
  --entries '[
    {
      "Id": "1",
      "Principal": {"DataLakePrincipalIdentifier": "IAMAllowedPrincipals"},
      "Resource": {
        "Database": {
          "CatalogId": "YOUR_ACCOUNT_ID",
          "Name": "lf-lh-silver-db-o-sp5-dev"
        }
      },
      "Permissions": ["ALL"]
    }
  ]'

# For staging environment
# ... use lf-lh-silver-db-o-sp5-staging
```

**Note**: This step is crucial - without it, IAM policies bypass Lake Formation tag-based controls.

### 2. Upload Test Data

```bash
# Dev environment
aws s3 cp silver_members.csv s3://lf-lh-silver-bkt-o-sp5-dev/members/
aws s3 cp user_transactions.csv s3://lf-lh-silver-bkt-o-sp5-dev/transactions/

# Staging environment
aws s3 cp silver_members.csv s3://lf-lh-silver-bkt-o-sp5-staging/members/
```

### 3. Run Glue Crawler

```bash
# Dev environment
aws glue start-crawler --name lf-lh-silver-crawler-o-sp5-dev

# Staging environment
aws glue start-crawler --name lf-lh-silver-crawler-o-sp5-staging
```

### 4. Tag Columns as PII

After the crawler creates tables, use the Python utility to tag PII columns:

```bash
# Dev environment
python tag_column_as_pii.py \
  --db lf-lh-silver-db-o-sp5-dev \
  --table members \
  --column ssn \
  --tag-key PII-o-sp5 \
  --tag-value true

python tag_column_as_pii.py \
  --db lf-lh-silver-db-o-sp5-dev \
  --table members \
  --column email \
  --tag-key PII-o-sp5 \
  --tag-value true

# Staging environment - same commands with staging database name
```

**Note**: Update `tag_column_as_pii.py` to use the new tag key `PII-o-sp5` instead of `PII`.

## Testing Access Control

### Test Dev User (Limited Access)

```bash
# Configure AWS CLI with dev user credentials from dev environment
export AWS_ACCESS_KEY_ID=<dev-user-key-id-from-stack-outputs>
export AWS_SECRET_ACCESS_KEY=<dev-user-secret-from-stack-outputs>

# Should succeed - non-PII columns
aws athena start-query-execution \
  --query-string "SELECT user_id, username FROM lf-lh-silver-db-o-sp5-dev.members" \
  --result-configuration "OutputLocation=s3://your-athena-results/"

# Should fail - PII column (dev user has PII-o-sp5=false policy)
aws athena start-query-execution \
  --query-string "SELECT ssn FROM lf-lh-silver-db-o-sp5-dev.members" \
  --result-configuration "OutputLocation=s3://your-athena-results/"
```

### Test Super User (Full Access)

```bash
# Configure AWS CLI with super user credentials
export AWS_ACCESS_KEY_ID=<super-user-key-id-from-stack-outputs>
export AWS_SECRET_ACCESS_KEY=<super-user-secret-from-stack-outputs>

# Should succeed - all columns including PII
aws athena start-query-execution \
  --query-string "SELECT * FROM lf-lh-silver-db-o-sp5-dev.members" \
  --result-configuration "OutputLocation=s3://your-athena-results/"
```

### Cross-Environment Isolation

```bash
# Dev user from dev environment cannot access staging resources
aws glue get-table \
  --database-name lf-lh-silver-db-o-sp5-staging \
  --name members
# Expected: AccessDeniedException (no permissions to staging resources)
```

## Stack Deletion

Delete a specific environment's master stack (automatically deletes nested stacks in reverse order):

```bash
# Delete dev environment
aws cloudformation delete-stack --stack-name lf-lh-master-stack-o-sp5-dev

# Delete staging environment (independent - no impact on dev)
aws cloudformation delete-stack --stack-name lf-lh-master-stack-o-sp5-staging
```

**Important**: If deletion fails due to non-empty S3 bucket:

```bash
# Empty the dev bucket first
aws s3 rm s3://lf-lh-silver-bkt-o-sp5-dev --recursive

# Retry deletion
aws cloudformation delete-stack --stack-name lf-lh-master-stack-o-sp5-dev
```

## Advantages of Nested Stacks

1. **Modularity**: Each stack has a single responsibility (IAM, Glue, Governance)
2. **Reusability**: IAM and Glue stacks can be reused in other projects
3. **Clearer Dependencies**: Explicit `DependsOn` shows deployment order
4. **Easier Debugging**: Isolate issues to specific nested stacks
5. **Parameter Passing**: Clean interface via Parameters/Outputs
6. **Single Deletion**: One command deletes all resources in correct order

## Comparison with Other Approaches

| Approach | Cross-Stack Pattern | Complexity | Flexibility |
|----------|-------------------|------------|-------------|
| **Monolithic** | N/A | Low | Low |
| **Serverless Split** | CloudFormation Outputs | Medium | Medium |
| **Serverless SSM** | SSM Parameter Store | Medium | High |
| **Nested Stacks** | Parent/Child Outputs | Low | Medium |

## Troubleshooting

### Nested Stack Not Found

**Error**: `Template URL must point to a valid S3 location`

**Solution**: Ensure templates are uploaded to S3 and bucket/prefix parameters are correct.

### Access Denied to Template

**Error**: `S3 error: Access Denied`

**Solution**: Make templates publicly readable or add CloudFormation service role:

```bash
aws s3api put-object-acl \
  --bucket your-cloudformation-templates-bucket \
  --key lf-nested-stacks/iam-stack.yaml \
  --acl public-read
```

### Stack Creation Timeout

**Error**: Stack stuck in `CREATE_IN_PROGRESS`

**Solution**: Check nested stack events for specific resource failures:

```bash
aws cloudformation describe-stack-events \
  --stack-name <nested-stack-id>
```

## References

- [AWS Nested Stacks Documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-nested-stacks.html)
- [Lake Formation Tag-Based Access Control](https://docs.aws.amazon.com/lake-formation/latest/dg/tag-based-access-control.html)
- Original monolithic template: `cfn/lakeformation-tags.yaml`
