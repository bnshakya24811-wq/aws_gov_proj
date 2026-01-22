# Multi-Environment Nested Stack Summary

## Changes Made

### 1. Environment Parameter Support
All stacks now accept an `Environment` parameter (dev, staging, prod) passed from the root stack.

### 2. Resource Naming Convention
All resources use the suffix pattern: `-o-sp5-${Environment}`

**Examples:**
- IAM User: `lf-lh-dev-user-o-sp5-dev`
- S3 Bucket: `lf-lh-silver-bkt-o-sp5-staging`
- Glue DB: `lf-lh-silver-db-o-sp5-prod`
- IAM Role: `lf-lh-glue-crawler-role-o-sp5-dev`

### 3. Lake Formation Tags (Environment-Agnostic)
Tags are shared across all environments with only the base suffix:
- `DBAccessScope-o-sp5` (values: silver, gold)
- `PII-o-sp5` (values: true, false)

**Rationale:** Tag policies are reusable. Only the tag *associations* to resources (databases/tables) are environment-specific.

### 4. Stack Naming
Each environment gets its own master stack:
- Dev: `lf-lh-master-stack-o-sp5-dev`
- Staging: `lf-lh-master-stack-o-sp5-staging`
- Prod: `lf-lh-master-stack-o-sp5-prod`

## Benefits

### ✅ Same Account Multi-Environment
```
AWS Account 123456789012
├── lf-lh-master-stack-o-sp5-dev (complete environment)
├── lf-lh-master-stack-o-sp5-staging (complete environment)
└── lf-lh-master-stack-o-sp5-prod (complete environment)
```

### ✅ Parallel Deployments
```bash
# Terminal 1 - Deploy dev
./deploy-example.sh dev &

# Terminal 2 - Deploy staging (no conflicts)
./deploy-example.sh staging &
```

### ✅ Resource Isolation
Dev users cannot access staging/prod resources due to different ARNs and database names.

### ✅ Shared Governance
Lake Formation tag keys are consistent across environments, simplifying policy management.

## Deployment Examples

### Deploy All Environments
```bash
# Sequential deployment to all environments
for env in dev staging prod; do
  ./deploy-example.sh $env
done
```

### Deploy Specific Environment
```bash
# Just dev
./deploy-example.sh dev

# Just production
./deploy-example.sh prod
```

### Update Specific Environment
```bash
# Update nested templates
aws s3 cp governance-stack.yaml s3://your-bucket/lf-nested-stacks/

# Update only dev environment
aws cloudformation deploy \
  --stack-name lf-lh-master-stack-o-sp5-dev \
  --template-file main.yaml \
  --parameter-overrides Environment=dev \
  --capabilities CAPABILITY_NAMED_IAM
```

## File Changes

### Modified Files
1. **main.yaml** - Added Environment parameter, passes to all child stacks
2. **iam-stack.yaml** - Added Environment parameter, resource names include suffix
3. **glue-stack.yaml** - Added Environment parameter, resource names include suffix
4. **governance-stack.yaml** - Added Environment parameter, tag keys include base suffix only
5. **README.md** - Updated with multi-environment instructions
6. **deploy-example.sh** - New deployment script for easy environment management

### Usage Pattern
```yaml
# Parent passes environment
Parameters:
  Environment: dev

Resources:
  MyBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Sub my-bucket-o-sp5-${Environment}
      # Result: my-bucket-o-sp5-dev
```

## Testing Scenarios

### 1. Deploy Two Environments
```bash
./deploy-example.sh dev
./deploy-example.sh staging
```

### 2. Verify Isolation
```bash
# List dev resources
aws glue get-databases --query 'DatabaseList[?Name==`lf-lh-silver-db-o-sp5-dev`]'

# List staging resources (separate)
aws glue get-databases --query 'DatabaseList[?Name==`lf-lh-silver-db-o-sp5-staging`]'
```

### 3. Test Cross-Environment Access Denial
```bash
# Use dev user credentials
export AWS_ACCESS_KEY_ID=<dev-user-key>

# Try to access staging database (should fail)
aws glue get-table \
  --database-name lf-lh-silver-db-o-sp5-staging \
  --name members
# Expected: AccessDeniedException
```

### 4. Delete One Environment (Others Unaffected)
```bash
# Delete dev (staging and prod continue running)
aws cloudformation delete-stack --stack-name lf-lh-master-stack-o-sp5-dev
```

## Migration from Existing Deployment

If you have existing resources without the suffix:

### Option 1: Deploy Alongside (Recommended)
```bash
# Keep existing resources
# Deploy new suffixed version
./deploy-example.sh dev

# Migrate data
aws s3 sync s3://lf-lh-silver-bkt s3://lf-lh-silver-bkt-o-sp5-dev

# Delete old stack when ready
```

### Option 2: Rename Resources (Risky)
Not recommended - would require manual resource updates and potential data migration.

## Best Practices

1. **Use deployment script** - Ensures consistent parameter passing
2. **Tag your stacks** - Add Environment tag for cost tracking
3. **Separate S3 buckets** - Each environment has isolated data
4. **Share LF tags** - Consistent tag keys across environments simplify governance
5. **Test in dev** - Validate changes before deploying to staging/prod
