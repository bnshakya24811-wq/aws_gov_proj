# Lake Formation Serverless Framework Deployment (SSM-based)

This project contains three Serverless Framework services for deploying Lake Formation infrastructure with tag-based access control, using **SSM Parameter Store** for cross-stack references instead of CloudFormation Outputs.

## Prerequisites

- Node.js 14.x or later
- Serverless Framework v3 installed: `npm install -g serverless@3`
- AWS credentials configured

## Project Structure

```
lf-lh-gov-serveress-ssm/
├── stack-0-lf-tags/          # Lake Formation Tags
├── stack-1-resources/        # Resources (DB, S3, IAM, Glue)
├── stack-2-permissions/      # Tag-based permissions
└── README.md
```

## SSM Parameter Store Approach

### **Key Differences from CloudFormation Outputs**

| Aspect | CloudFormation Outputs | SSM Parameter Store |
|--------|----------------------|---------------------|
| **Reference syntax** | `!ImportValue export-name` | `{{resolve:ssm:parameter-name}}` |
| **Scope** | Regional (per account) | Regional (per account) |
| **Deletion** | Can't delete if imported | Can delete anytime |
| **Dynamic updates** | Requires stack update | Update parameter directly |
| **Plugin access** | DescribeStacks API | GetParameter API |
| **Cost** | Free | Free (standard parameters) |

### **SSM Parameter Naming Convention**

```
/lf-lh/{stage}/tags/db-access-scope-key
/lf-lh/{stage}/tags/pii-key
/lf-lh/{stage}/resources/database-name
/lf-lh/{stage}/resources/bucket-name
/lf-lh/{stage}/resources/glue-crawler-role-arn
/lf-lh/{stage}/resources/glue-job-role-arn
/lf-lh/{stage}/resources/lf-dev-user-arn
/lf-lh/{stage}/resources/lf-super-user-arn
```

## Deployment Order

**IMPORTANT**: Deploy stacks in this exact order due to dependencies:

### 1. Deploy Stack 0 (LF Tags)
```bash
cd stack-0-lf-tags
serverless deploy --stage dev --region us-east-1
```

**Creates:**
- Lake Formation tags
- SSM parameters for tag keys

### 2. Deploy Stack 1 (Resources)
```bash
cd ../stack-1-resources
serverless deploy --stage dev --region us-east-1
```

**Creates:**
- Glue database, S3 bucket, IAM users/roles, Glue crawler
- SSM parameters for all resource ARNs and names

### 3. Deploy Stack 2 (Permissions)
```bash
cd ../stack-2-permissions
npm install  # Install plugin dependencies
serverless deploy --stage dev --region us-east-1
```

**Creates:**
- Tag-based Lake Formation permissions
- Runs post-deploy plugin to revoke IAMAllowedPrincipals

## How Cross-Stack References Work

### **In CloudFormation Templates**

```yaml
# Stack 2 references Stack 1's database name
Resources:
  MyPermission:
    Properties:
      Principal:
        # Resolves SSM parameter at deployment time
        DataLakePrincipalIdentifier: '{{resolve:ssm:/lf-lh/dev/resources/lf-super-user-arn}}'
```

### **In Plugin Code**

```javascript
// Get database name from SSM
const dbNameParam = await ssm.send(new GetParameterCommand({
  Name: `/lf-lh/${stage}/resources/database-name`
}));

const actualDatabaseName = dbNameParam.Parameter.Value;
```

## Advantages of SSM Approach

✅ **No export/import constraints**: Delete/update stacks independently  
✅ **Dynamic updates**: Update parameter without redeploying stack  
✅ **Simpler syntax**: Clear parameter paths vs complex export names  
✅ **Better organization**: Hierarchical parameter structure  
✅ **Versioning support**: SSM supports parameter versions  
✅ **Encryption**: Can use SecureString for sensitive values  

## Removal

Remove stacks in **reverse order**:

```bash
# Remove Stack 2
cd stack-2-permissions
serverless remove --stage dev --region us-east-1

# Remove Stack 1 (also deletes SSM parameters automatically)
cd ../stack-1-resources
serverless remove --stage dev --region us-east-1

# Remove Stack 0 (also deletes SSM parameters automatically)
cd ../stack-0-lf-tags
serverless remove --stage dev --region us-east-1
```

## Viewing SSM Parameters

```bash
# List all parameters for this deployment
aws ssm get-parameters-by-path \
  --path "/lf-lh/dev" \
  --recursive \
  --region us-east-1

# Get specific parameter
aws ssm get-parameter \
  --name "/lf-lh/dev/resources/database-name" \
  --region us-east-1
```

## Customization

### Change Stage
```bash
serverless deploy --stage prod --region us-east-1
# Creates new SSM parameters under /lf-lh/prod/
```

### Change Region
```bash
serverless deploy --stage dev --region us-west-2
```

## Comparison: Outputs vs SSM

**Use CloudFormation Outputs when:**
- Need strict dependency enforcement
- Prevent accidental deletion of referenced stacks
- Standard AWS cross-stack pattern sufficient

**Use SSM Parameter Store when:**
- Need flexibility to delete/update stacks independently
- Want hierarchical organization
- Need to update values without stack redeployment
- Require encryption for sensitive values
- Want simpler parameter names

## Notes

- All resource names include `-ssm` to differentiate from output-based deployment
- SSM parameters are automatically deleted when stacks are removed
- Plugin uses SSM GetParameter API instead of CloudFormation DescribeStacks
- Parameters can be encrypted using SecureString type if needed
