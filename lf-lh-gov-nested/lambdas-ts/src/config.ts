/**
 * Environment configuration
 */
import { EnvironmentConfig } from './types';

export const getConfig = (): EnvironmentConfig => {
  const config: EnvironmentConfig = {
    apiKeyTable: process.env.DYNAMODB_TABLE || process.env.API_KEY_TABLE || '',
    databaseName: process.env.DATABASE_NAME || '',
    athenaOutputBucket: process.env.ATHENA_OUTPUT_BUCKET || '',
    region: process.env.AWS_REGION || process.env.REGION || 'us-east-1',
    environment: process.env.ENVIRONMENT || 'dev',
    secretKeyPrefix: process.env.SECRET_KEY_PREFIX || 'lf-apikey-',
    cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID,
    cognitoClientId: process.env.COGNITO_CLIENT_ID,
    cognitoClientSecret: process.env.COGNITO_CLIENT_SECRET,
    lfDevRoleArn: process.env.LF_DEV_ROLE_ARN,
    lfSuperRoleArn: process.env.LF_SUPER_ROLE_ARN,
  };

  // Validate required environment variables (API_KEY_TABLE optional for OAuth-only)
  const missing: string[] = [];
  if (!config.databaseName) missing.push('DATABASE_NAME');
  if (!config.athenaOutputBucket) missing.push('ATHENA_OUTPUT_BUCKET');

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return config;
};
