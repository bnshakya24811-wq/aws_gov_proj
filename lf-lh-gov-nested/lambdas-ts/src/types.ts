/**
 * Type definitions for Lambda handler
 */

export interface QueryRequest {
  tableName: string;
  limit?: number;
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
  apiKey: string;
  roleArn: string;
  userName: string;
  permissions: string;
}

export interface EnvironmentConfig {
  apiKeyTable: string;
  databaseName: string;
  athenaOutputBucket: string;
  region: string;
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
