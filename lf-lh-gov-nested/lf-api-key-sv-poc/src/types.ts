/**
 * Type definitions for Lambda handler
 */

export interface QueryRequest {
  tableName?: string;
  database?: string;  // Database name (optional, defaults to env DATABASE_NAME)
  limit?: number;
  query?: string;  // For OAuth: raw SQL query
  username?: string;  // For OAuth: Cognito username
  password?: string;  // For OAuth: Cognito password
}

export interface QueryResponse {
  success: boolean;
  query?: string;
  rowCount?: number;
  data?: string[][];
  error?: string;
}

export interface AssumedCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

export interface ApiKeyMapping {
  secretName: string;
  roleArn: string;
  userName: string;
  secretArn?: string;
}

export interface SecretValue {
  apiKey: string;
  userName: string;
  apiKeyId?: string;
}

export interface EnvironmentConfig {
  apiKeyTable: string;
  databaseName: string;
  athenaOutputBucket: string;
  athenaOutputPrefix?: string;
  region: string;
  environment: string;
  secretKeyPrefix?: string;
  cognitoUserPoolId?: string;
  cognitoClientId?: string;
  cognitoClientSecret?: string;
  lfDevRoleArn?: string;
  lfSuperRoleArn?: string;
}

export enum QueryStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export interface ErrorResponse {
  statusCode: number;
  headers: {
    'Content-Type': string;
    'Access-Control-Allow-Origin': string;
  };
  body: string;
}
