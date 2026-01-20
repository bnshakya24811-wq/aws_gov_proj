# Lake Formation Serverless Framework Deployment

This project contains three Serverless Framework services for deploying Lake Formation infrastructure with tag-based access control.

## Prerequisites

- Node.js 14.x or later
- Serverless Framework v3 installed: `npm install -g serverless@3`
- AWS credentials configured

## Project Structure

```
lf-lh-gov-serverless-split/
├── stack-0-lf-tags/          # Lake Formation Tags
├── stack-1-resources/        # Resources (DB, S3, IAM, Glue)
├── stack-2-permissions/      # Tag-based permissions
└── README.md
```

## Deployment Order

**IMPORTANT**: Deploy stacks in this exact order due to cross-stack dependencies:

### 1. Deploy Stack 0 (LF Tags)
```bash
cd stack-0-lf-tags
serverless deploy --stage dev --region us-east-1
```

### 2. Deploy Stack 1 (Resources)
```bash
cd ../stack-1-resources
serverless deploy --stage dev --region us-east-1
```

### 3. Deploy Stack 2 (Permissions)
```bash
cd ../stack-2-permissions
npm install  # Install plugin dependencies
serverless deploy --stage dev --region us-east-1
```

**Note**: Stack 2 includes a custom post-deploy plugin that automatically revokes `IAMAllowedPrincipals` permissions from the Lake Formation database, ensuring Tag-Based Access Control (TBAC) is enforced.

## Stack Details

### Stack 0: LF Tags
Creates Lake Formation tags:
- `DBAccessScope-o-sp` with values: `silver-o-sp`, `gold-o-sp`
- `PII-o-sp` with values: `true`, `false`

### Stack 1: Resources
Creates:
- Glue Database: `lf-lh-silver-db-o-sp`
- S3 Bucket: `lf-lh-silver-bkt-o-sp-{stage}`
- IAM Users: `lf-lh-dev-user-o-sp-{stage}`, `lf-lh-super-user-o-sp-{stage}`
- IAM Roles: `glue-crawler-role-o-sp-{stage}`, `glue-job-role-o-sp-{stage}`
- Glue Crawler: `lf-lh-silver-crawler-o-sp-{stage}`

### Stack 2: Permissions
Creates tag-based Lake Formation permissions for:
- Dev User (restricted access, no PII)
- Super User (full access)
- Glue Crawler Role
- Glue Job Role

## Removal

Remove stacks in **reverse order**:

```bash
# Remove Stack 2
cd stack-2-permissions
serverless remove --stage dev --region us-east-1

# Remove Stack 1
cd ../stack-1-resources
serverless remove --stage dev --region us-east-1

# Remove Stack 0
cd ../stack-0-lf-tags
serverless remove --stage dev --region us-east-1
```

## Customization

### Change Stage
```bash
serverless deploy --stage prod --region us-east-1
```

### Change Region
```bash
serverless deploy --stage dev --region us-west-2
```

## Access Keys

After deploying Stack 1, retrieve access keys from CloudFormation outputs:
```bash
aws cloudformation describe-stacks \
  --stack-name lf-lh-stack-1-resources-o-sp-dev \
  --query 'Stacks[0].Outputs'
```

## Notes

- All resource names include `-o-sp` suffix to avoid conflicts
- Stage name is appended to most resources for multi-environment support
- Cross-stack references use CloudFormation exports/imports
- Serverless Framework v3 is the last free version (v4+ requires licensing)
