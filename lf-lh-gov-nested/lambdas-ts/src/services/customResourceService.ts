/**
 * Custom Resource Service
 * Handles CloudFormation custom resource logic for API key provisioning
 */
import {
  APIGatewayClient,
  GetApiKeyCommand,
} from '@aws-sdk/client-api-gateway';
import {
  SecretsManagerClient,
  CreateSecretCommand,
  PutSecretValueCommand,
  DescribeSecretCommand,
  DeleteSecretCommand,
  ResourceNotFoundException,
  ResourceExistsException,
} from '@aws-sdk/client-secrets-manager';
import {
  DynamoDBClient,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { APIKeyMapping, SecretData, ProcessedKeyResult } from '../types-custom-resource';
import { Logger } from '../utils/logger';

const logger = new Logger('CustomResourceService');

export class CustomResourceService {
  private apiGateway: APIGatewayClient;
  private secretsManager: SecretsManagerClient;
  private dynamodb: DynamoDBClient;

  constructor(region: string = 'us-east-1') {
    this.apiGateway = new APIGatewayClient({ region });
    this.secretsManager = new SecretsManagerClient({ region });
    this.dynamodb = new DynamoDBClient({ region });
  }

  /**
   * Process API key mappings (Create/Update)
   */
  async processAPIKeyMappings(
    mappings: APIKeyMapping[],
    tableName: string,
    environment: string
  ): Promise<Record<string, any>> {
    logger.info(`Processing ${mappings.length} API key mappings`);

    const responseData: Record<string, any> = {};

    for (const mapping of mappings) {
      const result = await this.processMapping(mapping, tableName, environment);
      
      // Add to response data
      responseData[`${mapping.UserName}SecretArn`] = result.secretArn;
      responseData[`${mapping.UserName}SecretName`] = result.secretName;
      responseData[`${mapping.UserName}GroupLabel`] = result.groupLabel;
    }

    responseData.ProcessedCount = mappings.length;
    logger.info(`Successfully processed ${mappings.length} API keys`);

    return responseData;
  }

  /**
   * Process a single API key mapping
   */
  private async processMapping(
    mapping: APIKeyMapping,
    tableName: string,
    environment: string
  ): Promise<ProcessedKeyResult> {
    const { APIKeyId, UserName, GroupLabel, RoleArn, SecretName } = mapping;

    // 1. Get API key value from API Gateway
    logger.info(`Retrieving API key for ${UserName}...`, { apiKeyId: APIKeyId });
    const apiKeyValue = await this.getAPIKeyValue(APIKeyId);

    // 2. Store in Secrets Manager
    const secretArn = await this.storeSecret(
      SecretName,
      apiKeyValue,
      UserName,
      GroupLabel,
      APIKeyId,
      environment
    );

    // 3. Store mapping in DynamoDB
    await this.storeDynamoDBMapping(
      tableName,
      SecretName,
      secretArn,
      RoleArn,
      UserName,
      GroupLabel,
      APIKeyId
    );

    logger.info(`Created DynamoDB mapping: ${SecretName} -> ${GroupLabel} -> ${RoleArn}`);

    return {
      secretArn,
      secretName: SecretName,
      groupLabel: GroupLabel,
      userName: UserName,
    };
  }

  /**
   * Get API key value from API Gateway
   */
  private async getAPIKeyValue(apiKeyId: string): Promise<string> {
    const command = new GetApiKeyCommand({
      apiKey: apiKeyId,
      includeValue: true,
    });

    const response = await this.apiGateway.send(command);
    
    if (!response.value) {
      throw new Error(`API key value not found for ID: ${apiKeyId}`);
    }

    return response.value;
  }

  /**
   * Store secret in Secrets Manager (create or update)
   */
  private async storeSecret(
    secretName: string,
    apiKeyValue: string,
    userName: string,
    groupLabel: string,
    apiKeyId: string,
    environment: string
  ): Promise<string> {
    const secretData: SecretData = {
      apiKey: apiKeyValue,
      userName,
      groupLabel,
      apiKeyId,
    };

    const secretString = JSON.stringify(secretData);

    try {
      // Try to create the secret
      const createCommand = new CreateSecretCommand({
        Name: secretName,
        Description: `${userName} API Key - ${groupLabel} group`,
        SecretString: secretString,
        Tags: [
          { Key: 'LFAPIKeyType', Value: 'api-key' },
          { Key: 'GroupLabel', Value: groupLabel },
          { Key: 'Environment', Value: environment },
          { Key: 'ManagedBy', Value: 'CloudFormation' },
          { Key: 'Project', Value: 'LakeFormationAccessControl' },
        ],
      });

      const createResponse = await this.secretsManager.send(createCommand);
      logger.info(`Created secret: ${secretName}`);
      
      return createResponse.ARN!;
    } catch (error) {
      if (error instanceof ResourceExistsException) {
        // Secret exists, update it
        logger.info(`Secret ${secretName} exists, updating...`);
        
        const updateCommand = new PutSecretValueCommand({
          SecretId: secretName,
          SecretString: secretString,
        });
        
        await this.secretsManager.send(updateCommand);
        
        // Get the ARN
        const describeCommand = new DescribeSecretCommand({
          SecretId: secretName,
        });
        
        const describeResponse = await this.secretsManager.send(describeCommand);
        logger.info(`Updated secret: ${secretName}`);
        
        return describeResponse.ARN!;
      }
      throw error;
    }
  }

  /**
   * Store mapping in DynamoDB
   */
  private async storeDynamoDBMapping(
    tableName: string,
    secretName: string,
    secretArn: string,
    roleArn: string,
    userName: string,
    groupLabel: string,
    apiKeyId: string
  ): Promise<void> {
    const command = new PutItemCommand({
      TableName: tableName,
      Item: {
        secretName: { S: secretName },
        secretArn: { S: secretArn },
        roleArn: { S: roleArn },
        userName: { S: userName },
        groupLabel: { S: groupLabel },
        apiKeyId: { S: apiKeyId },
      },
    });

    await this.dynamodb.send(command);
  }

  /**
   * Cleanup secrets on stack deletion
   */
  async deleteSecrets(mappings: APIKeyMapping[]): Promise<void> {
    logger.info(`Cleaning up ${mappings.length} secrets`);

    for (const mapping of mappings) {
      try {
        const command = new DeleteSecretCommand({
          SecretId: mapping.SecretName,
          ForceDeleteWithoutRecovery: true,
        });

        await this.secretsManager.send(command);
        logger.info(`Deleted secret: ${mapping.SecretName}`);
      } catch (error) {
        if (error instanceof ResourceNotFoundException) {
          logger.warn(`Secret ${mapping.SecretName} already deleted`);
        } else {
          logger.warn(`Failed to delete secret ${mapping.SecretName}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }
}
