/**
 * Service for API Key to IAM Role mapping lookups
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ApiKeyMapping } from '../types';
import { Logger } from '../utils/logger';
import { LambdaError } from '../utils/errorHandler';

export class ApiKeyService {
  private client: DynamoDBDocumentClient;
  private tableName: string;
  private logger: Logger;

  constructor(region: string, tableName: string) {
    const dynamoClient = new DynamoDBClient({ region });
    this.client = DynamoDBDocumentClient.from(dynamoClient);
    this.tableName = tableName;
    this.logger = new Logger('ApiKeyService');
  }

  /**
   * Look up IAM role ARN for the given API key
   */
  async getRoleForApiKey(apiKey: string): Promise<string> {
    try {
      this.logger.info('Looking up role for API key', {
        tableName: this.tableName,
      });

      const command = new GetCommand({
        TableName: this.tableName,
        Key: { apiKey },
      });

      const response = await this.client.send(command);

      if (!response.Item) {
        this.logger.warn('API key not found in DynamoDB');
        throw new LambdaError(403, 'Invalid API key');
      }

      const mapping = response.Item as ApiKeyMapping;

      if (!mapping.roleArn) {
        this.logger.error('Role ARN not found in mapping', undefined, {
          apiKey: apiKey.substring(0, 8) + '...',
        });
        throw new LambdaError(500, 'Invalid API key mapping');
      }

      this.logger.info('Successfully retrieved role ARN', {
        userName: mapping.userName,
        permissions: mapping.permissions,
      });

      return mapping.roleArn;
    } catch (error) {
      if (error instanceof LambdaError) {
        throw error;
      }
      this.logger.error('Error querying DynamoDB', error as Error);
      throw new LambdaError(500, 'Failed to lookup API key');
    }
  }
}
