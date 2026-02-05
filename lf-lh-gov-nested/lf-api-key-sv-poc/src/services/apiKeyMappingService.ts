/**
 * Service for API Key to Role mapping in DynamoDB
 * Reusable module for looking up role ARNs from secret names or API keys
 */
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { Logger } from '../utils/logger';
import { LambdaError } from '../utils/errorHandler';

export interface RoleMapping {
  secretName: string;
  roleArn: string;
  userName?: string;
  secretArn?: string;
  permissions?: string;
}

export class ApiKeyMappingService {
  private client: DynamoDBClient;
  private tableName: string;
  private logger: Logger;

  constructor(region: string, tableName: string) {
    this.client = new DynamoDBClient({ region });
    this.tableName = tableName;
    this.logger = new Logger('ApiKeyMappingService');
  }

  /**
   * Get role ARN from DynamoDB using secret name as key
   */
  async getRoleBySecretName(secretName: string): Promise<RoleMapping> {
    try {
      this.logger.info(`Looking up role mapping for secret: ${secretName}`);

      const command = new GetItemCommand({
        TableName: this.tableName,
        Key: { secret_name: { S: secretName } },
      });

      const response = await this.client.send(command);

      if (!response.Item) {
        this.logger.error(`No mapping found for secret: ${secretName}`);
        throw new LambdaError(500, 'Configuration error: missing role mapping');
      }

      const mapping: RoleMapping = {
        secretName,
        roleArn: response.Item.roleArn?.S || '',
        userName: response.Item.user_name?.S,
        secretArn: response.Item.secretArn?.S,
        permissions: response.Item.permissions?.S,
      };

      if (!mapping.roleArn) {
        this.logger.error('Role ARN not found in mapping');
        throw new LambdaError(500, 'Invalid role mapping: missing roleArn');
      }

      this.logger.info('Successfully retrieved role mapping', {
        userName: mapping.userName,
        roleArn: mapping.roleArn,
      });

      return mapping;
    } catch (error) {
      if (error instanceof LambdaError) {
        throw error;
      }
      this.logger.error('Error querying DynamoDB', error as Error);
      throw new LambdaError(500, 'Failed to lookup role mapping');
    }
  }

  /**
   * Get role ARN only (convenience method)
   */
  async getRoleArn(secretName: string): Promise<string> {
    const mapping = await this.getRoleBySecretName(secretName);
    return mapping.roleArn;
  }
}
