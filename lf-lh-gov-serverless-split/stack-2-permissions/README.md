# Stack 2: Lake Formation Permissions with IAM Revocation

This stack configures Lake Formation tag-based permissions and includes a custom plugin to revoke IAMAllowedPrincipals.

## Custom Plugin

The `revoke-iam-plugin.js` runs automatically after deployment to:
- Revoke `IAMAllowedPrincipals` permissions from the Glue database
- Ensure only Tag-Based Access Control (TBAC) is in effect
- Prevent IAM-based access bypass of Lake Formation permissions

## Standard Variable Reference Pattern

Cross-stack resources are referenced using the `custom` section:

```yaml
custom:
  stack0Name: lf-lh-stack-0-lf-tags-o-sp-${self:provider.stage}
  stack1Name: lf-lh-stack-1-resources-o-sp-${self:provider.stage}
  databaseName: lf-lh-silver-db-o-sp
```

The plugin accesses these via `this.serverless.service.custom`.

## Deployment

```bash
npm install
serverless deploy --stage dev --region us-east-1
```

## Plugin Behavior

Post-deployment, the plugin will:
1. Fetch the account ID and database name
2. Call Lake Formation `revokePermissions` API
3. Remove IAMAllowedPrincipals access to enforce TBAC
4. Log results (warnings if already revoked, errors if fails)

The deployment will succeed even if revocation fails (with warnings).

## Manual Revocation (if needed)

If the plugin fails, manually revoke using AWS CLI:

```bash
aws lakeformation revoke-permissions \
  --principal DataLakePrincipalIdentifier=IAMAllowedPrincipals \
  --resource '{"Database":{"Name":"lf-lh-silver-db-o-sp"}}' \
  --permissions ALL \
  --region us-east-1
```
