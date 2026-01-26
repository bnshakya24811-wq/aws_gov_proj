/**
 * Environment configuration
 */
import { EnvironmentConfig } from './types';

export const getConfig = (): EnvironmentConfig => {
  const config: EnvironmentConfig = {
    apiKeyTable: process.env.API_KEY_TABLE || '',
    databaseName: process.env.DATABASE_NAME || '',
    athenaOutputBucket: process.env.ATHENA_OUTPUT_BUCKET || '',
    region: process.env.REGION || 'us-east-1',
  };

  // Validate required environment variables
  const missing: string[] = [];
  if (!config.apiKeyTable) missing.push('API_KEY_TABLE');
  if (!config.databaseName) missing.push('DATABASE_NAME');
  if (!config.athenaOutputBucket) missing.push('ATHENA_OUTPUT_BUCKET');

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return config;
};
