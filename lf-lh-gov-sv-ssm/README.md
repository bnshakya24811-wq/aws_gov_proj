# Lake Formation Governance - Serverless Framework v3 (SSM Pattern)

This implementation demonstrates a two-stack Lake Formation setup using Serverless Framework v3 (free tier) with SSM Parameter Store for cross-stack references.

## Architecture

**Stack 1 (Resources):**
- Glue Database (`lf_lh_silver_db_sv`)
- Glue Crawler Role with necessary permissions
- Glue Crawler to ingest data from S3
- S3 Bucket for data storage
- SSM Parameters for cross-stack references

**Stack 2 (Permissions):**
- Lake Formation Tags (DBAccessScope, PII)
- Tag-based access control policies
- Lake Formation permissions for crawler role
- References Stack 1 resources via SSM

## SSM Key Pattern

Stack 1 exports resources to SSM using this pattern:
```
/gov-sv/{stack-name}/{env}/resourcetype/resourcename/attribute
```

**Example keys:**
- `/gov-sv/lf-lh-gov-sv-stack1/dev/database/silver/name`
- `/gov-sv/lf-lh-gov-sv-stack1/dev/role/crawler/arn`
- `/gov-sv/lf-lh-gov-sv-stack1/dev/role/crawler/name`
- `/gov-sv/lf-lh-gov-sv-stack1/dev/bucket/silver/name`
- `/gov-sv/lf-lh-gov-sv-stack1/dev/crawler/silver/name`

## Stack 2 SSM Reference Pattern

Stack 2 builds SSM keys using a mix of:
1. **`self:` variables** - Dynamic Serverless variables
2. **Hardcoded values** - Static strings like stack names
3. **`!Sub` intrinsic function** - CloudFormation substitution for ARN construction

Example:
```yaml
custom:
  ssmPrefix: /gov-sv/${self:custom.stack1Name}/${self:provider.stage}
  ssmDatabaseNameKey: ${self:custom.ssmPrefix}/database/silver/name

# Usage in resource:
DataLakePrincipalIdentifier: !Sub '{{resolve:ssm:${self:custom.ssmCrawlerRoleArnKey}}}'
```

## Deployment Order

**CRITICAL:** Deploy stacks in sequence due to dependencies.

### 1. Deploy Stack 1 (Resources)
```bash
cd stack-1-resources
serverless deploy --stage dev --region us-east-1
```

This creates:
- Glue database and crawler
- IAM role for crawler
- SSM parameters for cross-stack references

### 2. Deploy Stack 2 (Permissions)
```bash
cd ../stack-2-permissions
serverless deploy --stage dev --region us-east-1
```

This creates:
- Lake Formation tags
- Tag-based permissions for crawler role
- Database tag associations

## Verify SSM Parameters

```bash
aws ssm get-parameters-by-path \
  --path "/gov-sv/lf-lh-gov-sv-stack1/dev" \
  --recursive
```

## Upload Test Data

```bash
# Upload sample CSV to S3 bucket
aws s3 cp ../../silver_members.csv s3://lf-lh-silver-bkt-sv-dev/

# Run crawler to discover schema
aws glue start-crawler --name lf-lh-silver-crawler-sv
```

## Verify Lake Formation Permissions

1. Check Lake Formation console → Permissions → Tag-based access
2. Verify crawler role has access to DBAccessScope=silver
3. Check database tag associations

## Removal

**Reverse order required:**

```bash
# Stack 2 first
cd stack-2-permissions
serverless remove --stage dev --region us-east-1

# Then Stack 1
cd ../stack-1-resources
serverless remove --stage dev --region us-east-1
```

## Key Features

### SSM Advantages
- ✅ No CloudFormation export/import constraints
- ✅ Can update parameters independently
- ✅ No circular dependency issues
- ✅ Parameters persist after stack deletion (manual cleanup needed)

### Cross-Stack Reference Pattern
Stack 2 demonstrates three reference methods:
1. Using custom variable: `${self:custom.ssmDatabaseNameKey}`
2. Inline SSM resolution: `!Sub '{{resolve:ssm:/gov-sv/.../arn}}'`
3. Mixed hardcoded + self: `!Sub '{{resolve:ssm:/gov-sv/${self:custom.stack1Name}/${self:provider.stage}/...}}'`

## Testing

After deployment, test with Athena queries:
```sql
-- Check database exists
SHOW DATABASES;

-- Check tables (after crawler runs)
SHOW TABLES IN lf_lh_silver_db_sv;

-- Query data
SELECT * FROM lf_lh_silver_db_sv.silver_members LIMIT 10;
```

## Troubleshooting

**Stack 2 fails with "Parameter not found":**
- Ensure Stack 1 deployed successfully
- Verify SSM parameters exist: `aws ssm get-parameter --name /gov-sv/lf-lh-gov-sv-stack1/dev/role/crawler/arn`

**Crawler has no Lake Formation permissions:**
- Deploy Stack 2 after Stack 1
- Check LF console for tag-based policies

**S3 bucket already exists:**
- Change `bucketName` in stack-1-resources/serverless.yml
- Use unique suffix: `lf-lh-silver-bkt-sv-${self:provider.stage}-${AWS::AccountId}`
