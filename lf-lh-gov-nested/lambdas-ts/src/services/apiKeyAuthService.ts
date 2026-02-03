/**
 * Orchestration service for API Key authentication flow
 * Combines SecretsManagerService + ApiKeyMappingService + RoleService
 * Can be easily plugged into any Lambda that needs API key auth
 */
import { SecretsManagerService } from './secretsManagerService';
import { ApiKeyMappingService, RoleMapping } from './apiKeyMappingService';
import { RoleService } from './roleService';
import { AssumedCredentials } from '../types';
import { Logger } from '../utils/logger';
import { LambdaError } from '../utils/errorHandler';

export interface ApiKeyAuthResult {
  roleArn: string;
  userName?: string;
  secretName: string;
  credentials: AssumedCredentials;
}

export interface ApiKeyAuthConfig {
  region: string;
  dynamoTableName: string;
  environment?: string;
  secretKeyPrefix?: string;  // Keyword to narrow down secret keys (e.g., 'lf-apikey-')
}

/**
 * High-level service that orchestrates the complete API key authentication flow:
 * API Key → Secrets Manager → DynamoDB → Role Assumption
 */
export class ApiKeyAuthService {
  private secretsService: SecretsManagerService;
  private mappingService: ApiKeyMappingService;
  private roleService: RoleService;
  private environment?: string;
  private secretKeyPrefix: string;
  private logger: Logger;

  constructor(config: ApiKeyAuthConfig) {
    this.secretsService = new SecretsManagerService(config.region);
    this.mappingService = new ApiKeyMappingService(config.region, config.dynamoTableName);
    this.roleService = new RoleService(config.region);
    this.environment = config.environment;
    this.secretKeyPrefix = config.secretKeyPrefix || 'lf-apikey-';
    this.logger = new Logger('ApiKeyAuthService');
  }

  /**
   * Complete authentication flow: API key → Role credentials
   * 
   * Flow:
   * 1. Find secret containing the API key
   * 2. Get role ARN from DynamoDB using secret name
   * 3. Assume the role
   * 4. Return credentials
   */
  async authenticate(apiKey: string): Promise<ApiKeyAuthResult> {
    try {
      this.logger.info('Starting API key authentication flow');

      // Step 1: Find secret by API key value
      const secretMatch = await this.secretsService.findSecretByApiKey(
        apiKey,
        this.secretKeyPrefix,
        this.environment
      );

      if (!secretMatch) {
        throw new LambdaError(403, 'Invalid API key');
      }

      const { secretName, secretValue } = secretMatch;
      const userName = secretValue.userName || 'unknown';

      this.logger.info(`Found matching secret: ${secretName}, user: ${userName}`);

      // Step 2: Get role mapping from DynamoDB
      const mapping = await this.mappingService.getRoleBySecretName(secretName);

      // Step 3: Assume the role
      const credentials = await this.roleService.assumeRole(mapping.roleArn, userName);

      this.logger.info('API key authentication successful', {
        userName,
        roleArn: mapping.roleArn,
      });

      return {
        roleArn: mapping.roleArn,
        userName,
        secretName,
        credentials,
      };
    } catch (error) {
      if (error instanceof LambdaError) {
        throw error;
      }
      this.logger.error('API key authentication failed', error as Error);
      throw new LambdaError(500, 'Authentication failed');
    }
  }

  /**
   * Get only the role ARN without assuming the role
   * Useful if you want to defer role assumption
   */
  async getRoleArn(apiKey: string): Promise<string> {
    const secretMatch = await this.secretsService.findSecretByApiKey(
      apiKey,
      this.secretKeyPrefix,
      this.environment
    );

    if (!secretMatch) {
      throw new LambdaError(403, 'Invalid API key');
    }

    const mapping = await this.mappingService.getRoleBySecretName(secretMatch.secretName);
    return mapping.roleArn;
  }
}
