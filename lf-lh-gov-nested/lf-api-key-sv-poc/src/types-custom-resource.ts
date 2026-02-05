/**
 * Type definitions for CloudFormation Custom Resource
 */

export interface APIKeyMapping {
  APIKeyId: string;
  UserName: string;
  GroupLabel: string;
  RoleArn: string;
  SecretName: string;
}

export interface CustomResourceEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  RequestId: string;
  ResponseURL: string;
  ResourceType: string;
  LogicalResourceId: string;
  StackId: string;
  ResourceProperties: {
    ServiceToken: string;
    TableName: string;
    Environment: string;
    Version: string;
    APIKeyMappings: APIKeyMapping[];
  };
  PhysicalResourceId?: string;
  OldResourceProperties?: {
    TableName: string;
    Environment: string;
    Version: string;
    APIKeyMappings: APIKeyMapping[];
  };
}

export interface CustomResourceContext {
  awsRequestId: string;
  logGroupName: string;
  logStreamName: string;
  functionName: string;
  memoryLimitInMB: string;
  functionVersion: string;
  invokedFunctionArn: string;
  getRemainingTimeInMillis: () => number;
}

export enum CustomResourceStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export interface CustomResourceResponse {
  Status: CustomResourceStatus;
  Reason?: string;
  PhysicalResourceId: string;
  StackId: string;
  RequestId: string;
  LogicalResourceId: string;
  Data?: Record<string, any>;
}

export interface SecretData {
  apiKey: string;
  userName: string;
  groupLabel: string;
  apiKeyId: string;
}

export interface ProcessedKeyResult {
  secretArn: string;
  secretName: string;
  groupLabel: string;
  userName: string;
}
