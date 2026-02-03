/**
 * Service for Secrets Manager operations
 * Reusable module for scanning and retrieving secrets by pattern/value
 */
import { 
  SecretsManagerClient, 
  ListSecretsCommand, 
  GetSecretValueCommand,
  ListSecretsCommandInput,
  SecretListEntry
} from '@aws-sdk/client-secrets-manager';
import { Logger } from '../utils/logger';
import { LambdaError } from '../utils/errorHandler';

export interface SecretMatchResult {
  secretName: string;
  secretValue: any;
  metadata?: SecretListEntry;
}

export interface SecretScanOptions {
  namePrefix?: string;
  tagFilters?: { key: string; value?: string }[];
  maxResults?: number;
  environmentSuffix?: string;
}

export class SecretsManagerService {
  private client: SecretsManagerClient;
  private logger: Logger;

  constructor(region: string) {
    this.client = new SecretsManagerClient({ region });
    this.logger = new Logger('SecretsManagerService');
  }

  /**
   * List secrets matching the given criteria
   */
  async listSecrets(options: SecretScanOptions): Promise<SecretListEntry[]> {
    const filters: ListSecretsCommandInput['Filters'] = [];

    if (options.namePrefix) {
      filters.push({ Key: 'name', Values: [options.namePrefix] });
    }

    if (options.tagFilters) {
      options.tagFilters.forEach(tag => {
        if (tag.value) {
          filters.push({ Key: 'tag-value', Values: [tag.value] });
        } else {
          filters.push({ Key: 'tag-key', Values: [tag.key] });
        }
      });
    }

    const command = new ListSecretsCommand({
      Filters: filters.length > 0 ? filters : undefined,
      MaxResults: options.maxResults || 20,
    });

    this.logger.info('Listing secrets', { filters, maxResults: options.maxResults });

    const response = await this.client.send(command);
    return response.SecretList || [];
  }

  /**
   * Get the value of a specific secret
   */
  async getSecretValue<T = any>(secretName: string): Promise<T> {
    try {
      const command = new GetSecretValueCommand({ SecretId: secretName });
      const response = await this.client.send(command);

      if (!response.SecretString) {
        throw new LambdaError(500, `Secret ${secretName} has no string value`);
      }

      return JSON.parse(response.SecretString) as T;
    } catch (error) {
      this.logger.error(`Error retrieving secret ${secretName}`, error as Error);
      throw error;
    }
  }

  /**
   * Scan secrets to find one matching a specific field value
   * Generic method that can search for any field match
   */
  async findSecretByFieldValue<T = any>(
    scanOptions: SecretScanOptions,
    fieldName: keyof T,
    fieldValue: any
  ): Promise<SecretMatchResult | null> {
    const secrets = await this.listSecrets(scanOptions);

    this.logger.info(`Scanning ${secrets.length} secrets for matching ${String(fieldName)}`);

    for (const secretMetadata of secrets) {
      const secretName = secretMetadata.Name;
      if (!secretName) continue;

      // Filter by environment suffix if specified
      if (scanOptions.environmentSuffix && !secretName.endsWith(scanOptions.environmentSuffix)) {
        this.logger.debug(`Skipping secret (environment mismatch): ${secretName}`);
        continue;
      }

      try {
        const secretValue = await this.getSecretValue<T>(secretName);

        // Check if field matches
        if (secretValue[fieldName] === fieldValue) {
          this.logger.info(`Found matching secret: ${secretName}`);
          return {
            secretName,
            secretValue,
            metadata: secretMetadata,
          };
        }
      } catch (error) {
        this.logger.warn(`Error reading secret ${secretName}`, { 
          error: (error as Error).message 
        });
        continue;
      }
    }

    this.logger.warn('No matching secret found');
    return null;
  }

  /**
   * Convenience method: Find secret by API key value
   */
  async findSecretByApiKey(
    apiKey: string,
    namePrefix: string = 'lf-apikey-',
    environment?: string
  ): Promise<SecretMatchResult | null> {
    return this.findSecretByFieldValue(
      {
        namePrefix,
        tagFilters: [{ key: 'LFAPIKeyType' }],
        environmentSuffix: environment ? `-${environment}` : undefined,
      },
      'apiKey',
      apiKey
    );
  }
}
