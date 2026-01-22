# Stack 2 Security Gov - Deployment Guide

## Architecture Overview

This stack implements a **single account-level governance stack** that accepts an `Environment` parameter to deploy environment-specific nested stacks.

### Key Design Decisions

1. **Account-Level Main Stack**: The main `serverless.yml` deploys without a `--stage` parameter, creating an account-level stack
2. **Environment Parameter**: The stack accepts an `Environment` parameter (dev/staging/uat/prod) to determine which environment's resources to configure
3. **Three-Tier Nested Stack Pattern**:
   - **LF Tags Stack** (account-level) - Created once, shared across all environments
   - **Tag Associations Stack** (environment-specific) - Associates tags with environment-specific databases
   - **Permissions Stack** (environment-specific) - Grants permissions to environment-specific users/roles

## Deployment Workflow

### Prerequisites

1. Deploy Stack 1 (Resources) for each environment:
   ```bash
   cd ../stack-1-resources
   serverless deploy --stage dev --region us-east-1
   serverless deploy --stage uat --region us-east-1
   serverless deploy --stage prod --region us-east-1
   ```

2. Upload nested stack templates to S3:
   ```bash
   cd ../stack-2-security-gov
   
   # Create S3 bucket (one-time operation)
   aws s3 mb s3://lf-nested-templates-o-sp6 --region us-east-1
   
   # Upload nested templates
   aws s3 cp nested/ s3://lf-nested-templates-o-sp6/nested/ --recursive
   ```

### Deploy Governance Stack

**Important**: Deploy once per environment, updating the Environment parameter each time:

```bash
# Deploy for DEV environment
serverless deploy --region us-east-1 --param="Environment=dev"

# Deploy for UAT environment (updates the same stack with different parameter)
serverless deploy --region us-east-1 --param="Environment=uat"

# Deploy for PROD environment
serverless deploy --region us-east-1 --param="Environment=prod"
```

### How It Works

1. **First deployment (dev)**:
   - Creates account-level S3 bucket: `lf-nested-templates-o-sp6`
   - Creates LF Tags nested stack (account-level): `DBAccessScope-o-sp6`, `PII-o-sp6`
   - Creates Tag Associations nested stack for dev database
   - Creates Permissions nested stack for dev users/roles

2. **Second deployment (uat)**:
   - **Reuses** existing S3 bucket and LF Tags nested stack
   - **Updates** Tag Associations nested stack to point to uat database
   - **Updates** Permissions nested stack to use uat users/roles

3. **Third deployment (prod)**:
   - **Reuses** existing S3 bucket and LF Tags nested stack
   - **Updates** Tag Associations nested stack to point to prod database
   - **Updates** Permissions nested stack to use prod users/roles

## Stack Outputs

Each deployment exports environment-specific stack IDs:

```yaml
Outputs:
  Environment: dev/uat/prod
  LFTagsStackId: <account-level-stack-id>  # Same across all environments
  TagAssociationsStackId: <env-specific-stack-id>
    Export: lf-lh-stack-2-security-gov-o-sp6-TagAssociationsStackId-dev
  PermissionsStackId: <env-specific-stack-id>
    Export: lf-lh-stack-2-security-gov-o-sp6-PermissionsStackId-dev
```

## SSM Parameter Resolution

The stack reads environment-specific parameters from SSM:

```yaml
# Read from /lf-lh/dev/resources/* for dev
# Read from /lf-lh/uat/resources/* for uat
# Read from /lf-lh/prod/resources/* for prod

Parameters:
  DatabaseName: !Sub '{{resolve:ssm:/lf-lh/${Environment}/resources/database-name}}'
  LFDevUserArn: !Sub '{{resolve:ssm:/lf-lh/${Environment}/resources/lf-dev-user-arn}}'
  LFSuperUserArn: !Sub '{{resolve:ssm:/lf-lh/${Environment}/resources/lf-super-user-arn}}'
  GlueCrawlerRoleArn: !Sub '{{resolve:ssm:/lf-lh/${Environment}/resources/glue-crawler-role-arn}}'
  GlueJobRoleArn: !Sub '{{resolve:ssm:/lf-lh/${Environment}/resources/glue-job-role-arn}}'
```

## Update Nested Templates

If you modify nested stack templates, re-upload them to S3:

```bash
aws s3 cp nested/lf-tags-stack.yaml s3://lf-nested-templates-o-sp6/nested/
aws s3 cp nested/tag-associations-stack.yaml s3://lf-nested-templates-o-sp6/nested/
aws s3 cp nested/permissions-stack.yaml s3://lf-nested-templates-o-sp6/nested/

# Then redeploy with the desired environment
serverless deploy --region us-east-1 --param="Environment=dev"
```

## Removal

Remove the stack (this will remove all nested stacks):

```bash
serverless remove --region us-east-1
```

**Note**: This removes the governance configuration for **all environments** since they share the same main stack.

## Advantages of This Pattern

1. ✅ **No LF Tag Duplication**: Tags created once at account level
2. ✅ **Single Stack Management**: One main stack instead of one per environment
3. ✅ **Environment Isolation**: Each deployment configures different environment resources
4. ✅ **Parameter-Based Control**: Simple parameter change to switch environments
5. ✅ **Consistent Tag Keys**: All environments use the same `DBAccessScope-o-sp6` and `PII-o-sp6` tags

## Comparison: Old vs New Architecture

### Old Pattern (❌ Failed)
```
stack-2-security-gov-dev    → Creates LF tags + dev resources
stack-2-security-gov-uat    → Fails: LF tags already exist
```

### New Pattern (✅ Works)
```
stack-2-security-gov (param=dev)  → Creates LF tags + dev resources
stack-2-security-gov (param=uat)  → Reuses LF tags + uat resources
stack-2-security-gov (param=prod) → Reuses LF tags + prod resources
```

## Troubleshooting

### "Stack already exists"
If you deployed with `--stage` previously, remove it first:
```bash
serverless remove --stage dev --region us-east-1
```

### "Parameter not found: /lf-lh/{env}/resources/*"
Ensure Stack 1 was deployed for that environment:
```bash
cd ../stack-1-resources
serverless deploy --stage {env} --region us-east-1
```

### "Template URL must be HTTPS"
Verify S3 bucket is in the same region:
```bash
aws s3api get-bucket-location --bucket lf-nested-templates-o-sp6
```
