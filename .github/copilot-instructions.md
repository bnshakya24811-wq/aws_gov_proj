# Lake Formation Access Control POC - AI Coding Agent Guide

## Project Overview

This is a proof-of-concept demonstrating AWS Lake Formation Tag-Based Access Control (TBAC) using multiple deployment approaches. The project shows how to enforce fine-grained data access policies in a lakehouse architecture by revoking IAMAllowedPrincipals and relying solely on Lake Formation tags.

**Key architectural pattern**: Three-stack deployment where tags → resources → permissions must be deployed in strict sequence due to dependencies.

## Deployment Approaches

Three parallel implementations exist, each demonstrating different AWS cross-stack reference patterns:

1. **`cfn/`** - Pure CloudFormation templates (monolithic and split variants)
2. **`lf-lh-gov-serverless-split/`** - Serverless Framework using CloudFormation Outputs/ImportValue
3. **`lf-lh-gov-serveress-ssm/`** - Serverless Framework using SSM Parameter Store (note: typo "serveress" is intentional in folder name)

## Critical Deployment Workflow

**ALWAYS deploy in this order** (dependencies are hard-coded, not dynamic):

```bash
# Stack 0: Creates LF Tags (DBAccessScope, PII)
cd stack-0-lf-tags && serverless deploy --stage dev --region us-east-1

# Stack 1: Creates Glue DB, S3 bucket, IAM users/roles
cd ../stack-1-resources && serverless deploy --stage dev --region us-east-1

# Stack 2: Creates tag-based permissions + runs IAM revocation plugin
cd ../stack-2-permissions && npm install && serverless deploy --stage dev --region us-east-1
```

**Removal**: Must happen in reverse order (Stack 2 → 1 → 0)

## Cross-Stack Reference Patterns

### CloudFormation Outputs (serverless-split)
- Stack 0/1 export values via `Outputs.Export.Name`
- Stack 2 imports using `!ImportValue ${self:custom.stack1Name}-LFSuperUserArn`
- Custom variables defined in `custom` section reference stack names
- Example: [stack-2-permissions/serverless.yml](lf-lh-gov-serverless-split/stack-2-permissions/serverless.yml#L12-L14)

### SSM Parameter Store (serveress-ssm)
- Stack 0/1 write to `/lf-lh/${stage}/tags/*` and `/lf-lh/${stage}/resources/*`
- Stack 2 resolves at deploy time: `{{resolve:ssm:/lf-lh/dev/resources/lf-super-user-arn}}`
- Plugin reads SSM at runtime using AWS SDK v3
- **Advantage**: No deletion constraints, can update parameters independently
- Example: [stack-2-permissions/serverless.yml](lf-lh-gov-serveress-ssm/stack-2-permissions/serverless.yml#L14-L27)

## Custom Serverless Plugin Pattern

Both Serverless variants include `revoke-iam-plugin.js` that runs post-deployment:

```javascript
hooks: {
  'after:deploy:deploy': this.revokeDatabaseIAMPermissions.bind(this)
}
```

**Critical behavior**: 
- Revokes `IAMAllowedPrincipals` permissions from the Glue database
- Without this, IAM policies bypass Lake Formation TBAC
- Handles "already revoked" gracefully (warns instead of fails)
- SSM variant reads database name from Parameter Store; Outputs variant reads from CloudFormation DescribeStacks

## Naming Conventions

**Resource suffixes** differentiate deployment variants:
- `-o-sp2` / `-o-sp3` suffixes in serverless variants (original purpose: testing multiple deployments)
- Bucket names include stage: `lf-lh-silver-bkt-o-sp2-${stage}`
- Stack names follow pattern: `lf-lh-stack-{0|1|2}-{component}-o-sp-${stage}`

**Lake Formation tags**:
- `DBAccessScope-o-sp*`: Controls database-level access (`silver-o-sp*`, `gold-o-sp*`)
- `PII-o-sp*`: Controls column-level access (`true`, `false`)

## Tag Assignment Workflow

1. Deploy infrastructure (creates database without tables)
2. Use Python utility to tag columns after crawler runs:
   ```bash
   python tag_column_as_pii.py --db lf-lh-silver-db-o-sp --table members --column ssn
   ```
3. Script uses boto3 `lakeformation.add_lf_tags_to_resource()` with `TableWithColumns` resource type
4. Example: [tag_column_as_pii.py](tag_column_as_pii.py#L18-L30)

## Testing & Validation

Test data files:
- [silver_members.csv](silver_members.csv) - Contains PII columns for testing column-level TBAC
- [user_transactions.csv](user_transactions.csv) - Non-PII data

**Validation approach**:
1. Deploy all three stacks
2. Verify IAMAllowedPrincipals revocation in Lake Formation console
3. Test IAM user access with different tag policies (dev vs super user)
4. Confirm dev user cannot query PII-tagged columns

## Common Issues

**"Stack cannot be deleted because it's being imported"**: Use SSM variant instead of CloudFormation Outputs

**Plugin fails with "Grantee has no permissions"**: Warning is expected if IAMAllowedPrincipals already revoked

**Wrong deployment order**: Stack 2 will fail if Stack 0/1 outputs/parameters don't exist

**Forgotten `npm install`**: Stack 2 requires AWS SDK v3 dependencies for custom plugin

## File Organization

- `cfn/stack_split/` - CloudFormation templates (reference architecture)
- `lf-lh-gov-serverless-split/` - Serverless with CF Outputs (production pattern)
- `lf-lh-gov-serveress-ssm/` - Serverless with SSM (flexible pattern)
- `*.py` - Utility scripts for tagging columns post-deployment
- `*.csv` - Test datasets for crawler ingestion

## When Adding New Stacks

1. Maintain three-stack separation (tags → resources → permissions)
2. Update `custom` variables to reference correct stack names
3. For SSM variant: define new parameters in `/lf-lh/${stage}/` hierarchy
4. Add corresponding `Outputs` or `AWS::SSM::Parameter` resources
5. Update plugin code if new resources need IAM revocation
