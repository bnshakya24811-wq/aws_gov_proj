/**
 * Custom Serverless Plugin to revoke IAMAllowedPrincipals from Lake Formation database
 * This runs post-deployment to ensure Lake Formation Tag-Based Access Control (TBAC) is enforced
 */

const { CloudFormationClient, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');
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
    
    // Get custom variables
    const customVars = this.serverless.service.custom;
    const stack1Name = customVars.stack1Name;
    
    this.serverless.cli.log(`Stack1 Name: ${stack1Name}`);
    this.serverless.cli.log(`Region: ${region}`);
    
    // Initialize AWS SDK v3 clients
    const cloudformation = new CloudFormationClient({ region });
    const lakeformation = new LakeFormationClient({ region });
    const sts = new STSClient({ region });
    
    try {
      // Get AWS Account ID
      const identity = await sts.send(new GetCallerIdentityCommand({}));
      const accountId = identity.Account;
      this.serverless.cli.log(`Account ID: ${accountId}`);
      
      // Get database name dynamically from CloudFormation Stack 1 outputs
      this.serverless.cli.log(`Fetching database name from CloudFormation stack: ${stack1Name}`);
      const stackOutputs = await cloudformation.send(new DescribeStacksCommand({
        StackName: stack1Name
      }));
      
      const dbNameOutput = stackOutputs.Stacks[0].Outputs.find(
        output => output.OutputKey === 'DatabaseName'
      );
      
      if (!dbNameOutput) {
        throw new Error('DatabaseName output not found in Stack 1');
      }
      
      const actualDatabaseName = dbNameOutput.OutputValue;
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
