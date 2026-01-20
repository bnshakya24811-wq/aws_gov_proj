# Stack 2: Lake Formation Permissions with IAM Revocation (SSM-based)

This stack configures Lake Formation tag-based permissions and includes a custom plugin to revoke IAMAllowedPrincipals.

## SSM Parameter Store Integration

This implementation uses **SSM Parameter Store** instead of CloudFormation Outputs for cross-stack references.

### **How It Works**

#### In CloudFormation Resources
```yaml
Resources:
  MyPermission:
    Properties:
      Principal:
        # Resolve SSM parameter at deployment
        DataLakePrincipalIdentifier: '{{resolve:ssm:/lf-lh/dev/resources/lf-super-user-arn}}'
```

#### In Plugin Code
```javascript
// Query SSM Parameter Store
const dbNameParam = await ssm.send(new GetParameterCommand({
  Name: `/lf-lh/${stage}/resources/database-name`
}));

const actualDatabaseName = dbNameParam.Parameter.Value;
```

## Custom Plugin

The `revoke-iam-plugin.js` runs automatically after deployment to:
- Fetch database name from SSM Parameter Store
- Revoke `IAMAllowedPrincipals` permissions from the Glue database
- Ensure only Tag-Based Access Control (TBAC) is in effect

## Configuration Pattern

Cross-stack resources are referenced using SSM paths defined in the `custom` section:

```yaml
custom:
  ssmPrefix: /lf-lh/${self:provider.stage}
```

The plugin accesses this via `this.serverless.service.custom.ssmPrefix`.

## Deployment

```bash
npm install
serverless deploy --stage dev --region us-east-1
```

## Plugin Behavior

Post-deployment, the plugin will:
1. Fetch the SSM prefix from custom config
2. Query SSM for the database name
3. Call Lake Formation `revokePermissions` API
4. Remove IAMAllowedPrincipals access to enforce TBAC

## Advantages Over CloudFormation Outputs

✅ **No import constraints**: Can delete Stack 1 and recreate without Stack 2 errors  
✅ **Simpler paths**: `/lf-lh/dev/resources/database-name` vs complex export names  
✅ **Dynamic updates**: Update SSM parameter without redeploying stacks  
✅ **Better organization**: Hierarchical parameter structure  

## View SSM Parameters

```bash
# List all parameters for this deployment
aws ssm get-parameters-by-path \
  --path "/lf-lh/dev" \
  --recursive \
  --region us-east-1
```

## Manual Revocation (if needed)

If the plugin fails, manually revoke using AWS CLI:

```bash
aws lakeformation revoke-permissions \
  --principal DataLakePrincipalIdentifier=IAMAllowedPrincipals \
  --resource '{"Database":{"Name":"lf-lh-silver-db-o-sp"}}' \
  --permissions ALL \
  --region us-east-1
```
