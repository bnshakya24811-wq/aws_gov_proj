/**
 * Lambda handler for Athena queries with Lake Formation permissions.
 * Supports both API key and IAM authentication.
 * - API key: Maps API key to IAM role, assumes role, executes query
 * - IAM: Maps IAM user ARN to IAM role, assumes role, executes query
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getConfig } from './config';
import { QueryRequest } from './types';
import { ApiKeyService } from './services/apiKeyService';
import { IAMUserService } from './services/iamUserService';
import { RoleService } from './services/roleService';
import { AthenaService } from './services/athenaService';
import { createErrorResponse, createSuccessResponse, LambdaError } from './utils/errorHandler';
import { Logger } from './utils/logger';

const logger = new Logger('LambdaHandler');

/**
 * Main Lambda handler
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  logger.info('Lambda invocation started', {
    requestId: context.awsRequestId,
    functionName: context.functionName,
  });

  try {
    // Load configuration
    const config = getConfig();

    // Detect authentication method
    const apiKey = extractApiKey(event);
    const iamUserArn = extractIAMUserArn(event);

    if (!apiKey && !iamUserArn) {
      return createErrorResponse(401, 'Missing authentication: provide either API key or IAM credentials');
    }

    // Parse and validate request body
    const request = parseRequestBody(event);

    // Initialize services
    const roleService = new RoleService(config.region);
    const athenaService = new AthenaService(
      config.region,
      config.databaseName,
      config.athenaOutputBucket
    );

    let roleArn: string;
    let authMethod: string;

    // Determine Lake Formation role based on authentication method
    if (apiKey) {
      // API Key authentication
      authMethod = 'API_KEY';
      logger.info('Using API key authentication');
      const apiKeyService = new ApiKeyService(config.region, config.apiKeyTable);
      roleArn = await apiKeyService.getRoleForApiKey(apiKey);
    } else {
      // IAM authentication
      authMethod = 'IAM';
      logger.info('Using IAM authentication', { userArn: iamUserArn });
      const iamUserService = new IAMUserService();
      roleArn = iamUserService.getRoleForIAMUser(iamUserArn!);
    }

    // Workflow: Identity → Role ARN → Assume Role → Execute Query
    logger.info('Starting query workflow', {
      authMethod,
      tableName: request.tableName,
      limit: request.limit,
    });

    // Step 1: Assume the Lake Formation role
    const credentials = await roleService.assumeRole(roleArn);

    // Step 2: Execute Athena query with assumed credentials
    const { query, results } = await athenaService.executeQuery(
      request.tableName,
      request.limit!,
      credentials
    );

    // Step 3: Return results
    logger.info('Query workflow completed successfully', {
      authMethod,
      rowCount: results.length - 1, // Subtract header row
    });

    return createSuccessResponse({
      success: true,
      authMethod,
      query,
      rowCount: results.length - 1, // Subtract header row
      data: results,
    });
  } catch (error) {
    if (error instanceof LambdaError) {
      logger.warn('Known error occurred', { statusCode: error.statusCode, message: error.message });
      return createErrorResponse(error.statusCode, error.message);
    }

    logger.error('Unexpected error occurred', error as Error);
    return createErrorResponse(500, `Internal server error: ${(error as Error).message}`);
  }
};

/**
 * Extract API key from request headers
 */
function extractApiKey(event: APIGatewayProxyEvent): string | null {
  const headers = event.headers || {};
  return headers['x-api-key'] || headers['X-Api-Key'] || null;
}

/**
 * Extract IAM user ARN from request context (for AWS_IAM authorization)
 */
function extractIAMUserArn(event: APIGatewayProxyEvent): string | null {
  const identity = event.requestContext?.identity;
  
  // For IAM authentication, userArn is populated
  if (identity?.userArn) {
    return identity.userArn;
  }
  
  // Also check accountId and user (alternative format)
  if (identity?.accountId && identity?.user) {
    return `arn:aws:iam::${identity.accountId}:user/${identity.user}`;
  }
  
  return null;
}

/**
 * Parse and validate request body
 */
function parseRequestBody(event: APIGatewayProxyEvent): QueryRequest {
  try {
    const body: QueryRequest = JSON.parse(event.body || '{}');

    if (!body.tableName) {
      throw new LambdaError(400, 'Missing required parameter: tableName');
    }

    const limit = body.limit || 100;

    if (typeof limit !== 'number' || limit < 1 || limit > 1000) {
      throw new LambdaError(400, 'limit must be between 1 and 1000');
    }

    return {
      tableName: body.tableName,
      limit,
    };
  } catch (error) {
    if (error instanceof LambdaError) {
      throw error;
    }
    throw new LambdaError(400, 'Invalid JSON in request body');
  }
}
