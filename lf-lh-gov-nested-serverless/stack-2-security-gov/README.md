# Stack 2: Security Governance (Nested CloudFormation)

## Overview

This stack implements **account-level governance** with **environment-specific nested stacks** for Lake Formation tag-based access control.

### Architecture Pattern

```
┌─────────────────────────────────────────────────────────┐
│ Main Governance Stack (Account-Level)                  │
│ Stack: lf-lh-stack-2-security-gov-o-sp6                │
│ Deployment: serverless deploy --param="Environment=X"   │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌────────────────────────────────────────────────┐   │
│  │ Nested Stack 1: LF Tags (Account-Level)        │   │
│  │ - DBAccessScope-o-sp6: [silver, gold]          │   │
│  │ - PII-o-sp6: [true, false]                     │   │
│  │ Created once, shared across all environments   │   │
│  └────────────────────────────────────────────────┘   │
│                                                          │
│  ┌────────────────────────────────────────────────┐   │
│  │ Nested Stack 2: Tag Associations (Env-Specific)│   │
│  │ - Associates tags with database for ${Env}     │   │
│  │ - Reads DB name from SSM: /lf-lh/${Env}/...   │   │
│  └────────────────────────────────────────────────┘   │
│                                                          │
│  ┌────────────────────────────────────────────────┐   │
│  │ Nested Stack 3: Permissions (Env-Specific)     │   │
│  │ - Grants LF permissions to ${Env} users/roles  │   │
│  │ - Reads ARNs from SSM: /lf-lh/${Env}/...      │   │
│  └────────────────────────────────────────────────┘   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

## Key Features

✅ **Single Main Stack**: One account-level governance stack for all environments  
✅ **No Tag Duplication**: LF tags created once, shared across dev/uat/prod  
✅ **Environment Parameter**: Deploy with `--param="Environment=dev"` to configure specific environment  
✅ **SSM-Based Dependencies**: Reads environment-specific resources from Stack 1 via SSM Parameter Store  
✅ **Nested Stack Pattern**: Separates account-level from environment-level resources  

## Deployment

### Quick Start

```bash
# Deploy for all environments
./deploy-all-envs.sh us-east-1
```

### Manual Deployment

```bash
# 1. Upload nested templates to S3
aws s3 mb s3://lf-nested-templates-o-sp6 --region us-east-1
aws s3 cp nested/ s3://lf-nested-templates-o-sp6/nested/ --recursive

# 2. Deploy for each environment
serverless deploy --region us-east-1 --param="Environment=dev"
serverless deploy --region us-east-1 --param="Environment=uat"
serverless deploy --region us-east-1 --param="Environment=prod"
```

Each deployment **updates** the same main stack but configures different environment resources.

## How It Works

### First Deployment (dev)
```bash
serverless deploy --param="Environment=dev"
```
- Creates main stack: `lf-lh-stack-2-security-gov-o-sp6`
- Creates nested LF Tags stack (account-level)
- Creates nested Tag Associations stack pointing to dev database
- Creates nested Permissions stack for dev users/roles

### Second Deployment (uat)
```bash
serverless deploy --param="Environment=uat"
```
- **Updates** main stack with new parameter value
- **Reuses** existing LF Tags nested stack
- **Updates** Tag Associations to point to uat database
- **Updates** Permissions for uat users/roles

### Third Deployment (prod)
```bash
serverless deploy --param="Environment=prod"
```
- **Updates** main stack with new parameter value
- **Reuses** existing LF Tags nested stack
- **Updates** Tag Associations to point to prod database
- **Updates** Permissions for prod users/roles

## Dependencies

This stack depends on **Stack 1 (Resources)** being deployed for each environment:

```bash
cd ../stack-1-resources
serverless deploy --stage dev --region us-east-1
serverless deploy --stage uat --region us-east-1
serverless deploy --stage prod --region us-east-1
```

Stack 1 writes these SSM parameters:
- `/lf-lh/{env}/resources/database-name`
- `/lf-lh/{env}/resources/lf-dev-user-arn`
- `/lf-lh/{env}/resources/lf-super-user-arn`
- `/lf-lh/{env}/resources/glue-crawler-role-arn`
- `/lf-lh/{env}/resources/glue-job-role-arn`

Stack 2 reads them using CloudFormation `{{resolve:ssm:...}}` syntax.

## Nested Stack Templates

### 1. lf-tags-stack.yaml
**Scope**: Account-level  
**Purpose**: Creates Lake Formation tags once for the entire account  
**Resources**:
- `AWS::LakeFormation::Tag` - DBAccessScope-o-sp6
- `AWS::LakeFormation::Tag` - PII-o-sp6

### 2. tag-associations-stack.yaml
**Scope**: Environment-specific  
**Purpose**: Associates tags with environment-specific Glue database  
**Parameters**: `Environment`, `DatabaseName`  
**Resources**:
- `AWS::LakeFormation::TagAssociation` - Tags database with DBAccessScope

### 3. permissions-stack.yaml
**Scope**: Environment-specific  
**Purpose**: Grants LF permissions to environment-specific IAM users/roles  
**Parameters**: `Environment`, `LFDevUserArn`, `LFSuperUserArn`, etc.  
**Resources**:
- Multiple `AWS::LakeFormation::PrincipalPermissions` for different user types

## Stack Outputs

The main stack exports environment-specific stack IDs:

```yaml
lf-lh-stack-2-security-gov-o-sp6-TagAssociationsStackId-dev
lf-lh-stack-2-security-gov-o-sp6-TagAssociationsStackId-uat
lf-lh-stack-2-security-gov-o-sp6-TagAssociationsStackId-prod

lf-lh-stack-2-security-gov-o-sp6-PermissionsStackId-dev
lf-lh-stack-2-security-gov-o-sp6-PermissionsStackId-uat
lf-lh-stack-2-security-gov-o-sp6-PermissionsStackId-prod
```

## Updating Nested Templates

If you modify any nested stack template:

```bash
# 1. Upload updated template
aws s3 cp nested/permissions-stack.yaml s3://lf-nested-templates-o-sp6/nested/

# 2. Redeploy for affected environment
serverless deploy --region us-east-1 --param="Environment=dev"
```

CloudFormation will detect the template change and update only the affected nested stack.

## Removal

To remove the governance stack for all environments:

```bash
serverless remove --region us-east-1
```

**Warning**: This removes governance configuration for **all environments** since they share the same main stack.

## Comparison with Stack-per-Environment Pattern

### Old Pattern (Stack 0 + Stack 2 per environment)
```
❌ stack-0-lf-tags-dev   → Creates LF tags
❌ stack-2-permissions-dev → Uses dev resources
❌ stack-0-lf-tags-uat   → FAILS: LF tags already exist
```

### New Pattern (Single Stack 2 with Environment parameter)
```
✅ stack-2-security-gov (param=dev) → Creates LF tags + dev resources
✅ stack-2-security-gov (param=uat) → Reuses LF tags + uat resources
✅ stack-2-security-gov (param=prod) → Reuses LF tags + prod resources
```

## Advantages

1. **No Resource Duplication**: LF tags are account-scoped, created once
2. **Simplified Management**: One stack instead of N stacks
3. **Clear Separation**: Account-level vs environment-level resources
4. **Flexible Deployment**: Deploy environments in any order
5. **Cost Effective**: Fewer CloudFormation stacks to maintain

## Troubleshooting

See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for detailed troubleshooting steps.

## Files

```
stack-2-security-gov/
├── serverless.yml              # Main governance stack (account-level)
├── nested/
│   ├── lf-tags-stack.yaml     # LF tags (account-level)
│   ├── tag-associations-stack.yaml  # Tag associations (env-specific)
│   └── permissions-stack.yaml  # Permissions (env-specific)
├── deploy-all-envs.sh         # Deploy script for all environments
├── DEPLOYMENT_GUIDE.md        # Detailed deployment instructions
└── README.md                  # This file
```
