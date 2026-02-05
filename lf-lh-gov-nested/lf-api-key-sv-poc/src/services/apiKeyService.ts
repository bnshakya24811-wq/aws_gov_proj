/**
 * Service for API Key to IAM Role mapping lookups
 * Flow: API Key → Secrets Manager scan → DynamoDB lookup (secretName → roleArn)
 */
import { SecretsManagerClient, ListSecretsCommand, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { ApiKeyMapping, SecretValue } from '../types';
import { Logger } from '../utils/logger';
import { LambdaError } from '../utils/errorHandler';

export class ApiKeyService {
  private secretsClient: SecretsManagerClient;
  private dynamoClient: DynamoDBClient;
  private tableName: string;
  private environment: string;
  private logger: Logger;

  constructor(region: string, tableName: string, environment: string) {
    this.secretsClient = new SecretsManagerClient({ region });
    this.dynamoClient = new DynamoDBClient({ region });
    this.tableName = tableName;
    this.environment = environment;
    this.logger = new Logger('ApiKeyService');
  }

  /**
   * Look up IAM role ARN for the given API key
   * Flow:
   * 1. List Secrets Manager with 'lf-apikey-*' pattern and LFAPIKeyType tag
   * 2. Scan each secret to find matching API key value
   * 3. Use matched secretName to query DynamoDB
   * 4. Return roleArn from DynamoDB mapping
   */
  async getRoleForApiKey(apiKey: string): Promise<string> {
    try {
      this.logger.info(`Searching for API key match in secrets with pattern: lf-apikey-*-${this.environment}`);

      // Step 1: List secrets with naming pattern and tag filter
      const listCommand = new ListSecretsCommand({
        Filters: [
          { Key: 'name', Values: ['lf-apikey-'] },
          { Key: 'tag-key', Values: ['LFAPIKeyType'] }
        ],
        MaxResults: 20
      });

      const listResponse = await this.secretsClient.send(listCommand);

      if (!listResponse.SecretList || listResponse.SecretList.length === 0) {
        this.logger.warn('No secrets found with lf-apikey-* pattern');
        throw new LambdaError(403, 'Invalid API key');
      }

      // Step 2: Check each secret for matching API key
      let matchedSecretName: string | null = null;
      let userName: string | null = null;

      for (const secretMetadata of listResponse.SecretList) {
        const secretName = secretMetadata.Name;
        
        if (!secretName) continue;

        // Only check secrets for our environment
        if (!secretName.endsWith(`-${this.environment}`)) {
          continue;
        }

        try {
          const getSecretCommand = new GetSecretValueCommand({ SecretId: secretName });
          const secretResponse = await this.secretsClient.send(getSecretCommand);
          
          if (!secretResponse.SecretString) continue;

          const secretData: SecretValue = JSON.parse(secretResponse.SecretString);

          // Check if API key matches
          if (secretData.apiKey === apiKey) {
            matchedSecretName = secretName;
            userName = secretData.userName || 'unknown';
            this.logger.info(`Found matching API key in secret: ${secretName}, user: ${userName}`);
            break;
          }
        } catch (error) {
          this.logger.warn(`Error reading secret ${secretName}`, { error: (error as Error).message });
          continue;
        }
      }

      // If no match found in secrets
      if (!matchedSecretName) {
        this.logger.warn('No matching API key found in secrets');
        throw new LambdaError(403, 'Invalid API key');
      }

      // Step 3: Lookup role ARN in DynamoDB using secret name
      this.logger.info(`Looking up DynamoDB mapping for secret: ${matchedSecretName}`);
      
      const dynamoCommand = new GetItemCommand({
        TableName: this.tableName,
        Key: { secretName: { S: matchedSecretName } }
      });

      const dynamoResponse = await this.dynamoClient.send(dynamoCommand);

      if (!dynamoResponse.Item) {
        this.logger.error(`No DynamoDB mapping found for secret: ${matchedSecretName}`);
        throw new LambdaError(500, 'Configuration error: missing role mapping');
      }

      const roleArn = dynamoResponse.Item.roleArn?.S;

      if (!roleArn) {
        this.logger.error('Role ARN not found in DynamoDB mapping');
        throw new LambdaError(500, 'Invalid API key mapping');
      }

      this.logger.info(`Found role mapping: user=${userName}, role=${roleArn}`);
      return roleArn;

    } catch (error) {
      if (error instanceof LambdaError) {
        throw error;
      }
      this.logger.error('Error during API key lookup', error as Error);
      throw new LambdaError(500, 'Failed to lookup API key');
    }
  }
}
