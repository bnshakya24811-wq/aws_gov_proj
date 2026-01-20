/**
 * Custom Serverless Plugin to revoke IAMAllowedPrincipals from Lake Formation database
 * This runs post-deployment to ensure Lake Formation Tag-Based Access Control (TBAC) is enforced
 * 
 * SSM-based cross-stack reference version
 */

const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { LakeFormationClient, RevokePermissionsCommand } = require('@aws-sdk/client-lakeformation');
const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');

class RevokeLakeFormationIAMPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.provider = this.serverless.getProvider('aws');
    
    this.hooks = {
      'after:deploy:deploy': this.revokeDatabaseIAMPermissions.bind(this)
    };
  }

  async revokeDatabaseIAMPermissions() {
    const stage = this.options.stage || this.serverless.service.provider.stage;
    const region = this.options.region || this.serverless.service.provider.region;
    
    this.serverless.cli.log('Starting Lake Formation IAM permissions revocation...');
    
    // Get custom variables (SSM paths)
    const customVars = this.serverless.service.custom;
    const ssmPaths = customVars.ssmPaths;
    
    this.serverless.cli.log(`Database SSM Path: ${ssmPaths.databaseName}`);
    this.serverless.cli.log(`Region: ${region}`);
    
    // Initialize AWS SDK v3 clients
    const ssm = new SSMClient({ region });
    const lakeformation = new LakeFormationClient({ region });
    const sts = new STSClient({ region });
    
    try {
      // Get AWS Account ID
      const identity = await sts.send(new GetCallerIdentityCommand({}));
      const accountId = identity.Account;
      this.serverless.cli.log(`Account ID: ${accountId}`);
      
      // Get database name from SSM Parameter Store using custom path
      const dbParamPath = ssmPaths.databaseName;
      this.serverless.cli.log(`Fetching database name from SSM: ${dbParamPath}`);
      const dbNameParam = await ssm.send(new GetParameterCommand({
        Name: dbParamPath
      }));
      
      const actualDatabaseName = dbNameParam.Parameter.Value;
      this.serverless.cli.log(`Resolved Database Name: ${actualDatabaseName}`);
      
      // Revoke IAMAllowedPrincipals permissions on the database
      this.serverless.cli.log(`Revoking IAMAllowedPrincipals from database: ${actualDatabaseName}`);
      
      const revokeParams = {
        CatalogId: accountId,
        Principal: {
          DataLakePrincipalIdentifier: 'IAMAllowedPrincipals'
        },
        Resource: {
          Database: {
            CatalogId: accountId,
            Name: actualDatabaseName
          }
        },
        Permissions: ['ALL'],
        PermissionsWithGrantOption: []
      };
      
      try {
        await lakeformation.send(new RevokePermissionsCommand(revokeParams));
        this.serverless.cli.log('✓ Successfully revoked IAMAllowedPrincipals permissions from database');
      } catch (error) {
        if (error.code === 'InvalidInputException' && error.message.includes('Grantee has no permissions')) {
          this.serverless.cli.log('⚠ IAMAllowedPrincipals already has no permissions on this database');
        } else {
          throw error;
        }
      }
      
      // Also revoke CREATE_TABLE permission if it exists
      const revokeCreateTableParams = {
        CatalogId: accountId,
        Principal: {
          DataLakePrincipalIdentifier: 'IAMAllowedPrincipals'
        },
        Resource: {
          Database: {
            CatalogId: accountId,
            Name: actualDatabaseName
          }
        },
        Permissions: ['CREATE_TABLE'],
        PermissionsWithGrantOption: []
      };
      
      try {
        await lakeformation.send(new RevokePermissionsCommand(revokeCreateTableParams));
        this.serverless.cli.log('✓ Successfully revoked CREATE_TABLE permission from IAMAllowedPrincipals');
      } catch (error) {
        if (error.code === 'InvalidInputException' && error.message.includes('Grantee has no permissions')) {
          this.serverless.cli.log('⚠ IAMAllowedPrincipals already has no CREATE_TABLE permission');
        } else {
          // Log but don't fail - this is optional cleanup
          this.serverless.cli.log(`⚠ Could not revoke CREATE_TABLE: ${error.message}`);
        }
      }
      
      this.serverless.cli.log('✓ Lake Formation IAM permissions revocation completed successfully');
      
    } catch (error) {
      this.serverless.cli.log(`✗ Error revoking Lake Formation permissions: ${error.message}`);
      // Don't fail the deployment, just warn
      this.serverless.cli.log('⚠ Deployment succeeded, but manual IAM permission revocation may be required');
    }
  }
}

module.exports = RevokeLakeFormationIAMPlugin;
