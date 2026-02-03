/**
 * Lambda handler for Athena queries with Lake Formation permissions.
 * Supports three authentication methods:
 * - API key: Maps API key to IAM role, assumes role, executes query
 * - IAM: Maps IAM user ARN to IAM role, assumes role, executes query
 * - OAuth: Authenticates with Cognito, maps user to IAM role, assumes role, executes query
 */
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getConfig } from './config';
import { QueryRequest } from './types';
import { ApiKeyAuthService } from './services/apiKeyAuthService';
import { IAMUserService } from './services/iamUserService';
import { CognitoService } from './services/cognitoService';
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

    // Parse request body first to check for OAuth credentials
    const body = parseBody(event);

    // Detect authentication method
    const apiKey = extractApiKey(event);
    const iamUserArn = extractIAMUserArn(event);
    const hasOAuthCredentials = body.username && body.password;

    if (!apiKey && !iamUserArn && !hasOAuthCredentials) {
      return createErrorResponse(
        401,
        'Missing authentication: provide API key, IAM credentials, or username/password'
      );
    }

    // Initialize services
    const roleService = new RoleService(config.region);
    const athenaService = new AthenaService(
      config.region,
      config.databaseName,
      config.athenaOutputBucket
    );

    let roleArn: string;
    let authMethod: string;
    let username: string | undefined;
    let userGroups: string[] = [];
    let credentials: any; // Will hold assumed credentials

    // Determine Lake Formation role based on authentication method
    if (hasOAuthCredentials) {
      // OAuth authentication with Cognito
      authMethod = 'OAUTH';
      logger.info('Using OAuth authentication');

      if (!config.cognitoUserPoolId || !config.cognitoClientId || !config.cognitoClientSecret) {
        return createErrorResponse(500, 'OAuth not configured on this endpoint');
      }

      if (!config.lfDevRoleArn || !config.lfSuperRoleArn) {
        return createErrorResponse(500, 'Lake Formation roles not configured');
      }

      const cognitoService = new CognitoService(
        config.region,
        config.cognitoUserPoolId,
        config.cognitoClientId,
        config.cognitoClientSecret
      );

      // Authenticate user
      const authResult = await cognitoService.authenticateUser(body.username!, body.password!);

      // Get user info and groups
      const userInfo = await cognitoService.getUserInfo(authResult.accessToken);
      username = userInfo.username;
      userGroups = userInfo.groups;

      // Map user to LF role
      roleArn = cognitoService.mapUserToLFRole(
        userInfo,
        config.lfDevRoleArn,
        config.lfSuperRoleArn
      );
    } else if (apiKey) {
      // API Key authentication - Using modular ApiKeyAuthService
      authMethod = 'API_KEY';
      logger.info('Using API key authentication');
      
      const apiKeyAuthService = new ApiKeyAuthService({
        region: config.region,
        dynamoTableName: config.apiKeyTable,
        environment: config.environment,
        secretKeyPrefix: config.secretKeyPrefix,
      });
      
      const authResult = await apiKeyAuthService.authenticate(apiKey);
      roleArn = authResult.roleArn;
      username = authResult.userName;
      
      // Credentials already obtained from authenticate()
      credentials = authResult.credentials;
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
      query: body.query,
      tableName: body.tableName,
    });

    // Step 1: Assume the Lake Formation role (if not already done)
    if (!credentials) {
      credentials = await roleService.assumeRole(roleArn);
    }

    // Step 2: Execute Athena query with assumed credentials
    let query: string;
    let results: string[][];

    if (body.query) {
      // OAuth: Execute raw SQL query
      const queryResult = await athenaService.executeRawQuery(body.query, credentials);
      query = queryResult.query;
      results = queryResult.results;
    } else {
      // API Key / IAM: Execute table query
      if (!body.tableName) {
        throw new LambdaError(400, 'Missing required parameter: tableName or query');
      }
      const limit = body.limit || 100;
      const queryResult = await athenaService.executeQuery(body.tableName, limit, credentials);
      query = queryResult.query;
      results = queryResult.results;
    }

    // Step 3: Return results
    logger.info('Query workflow completed successfully', {
      authMethod,
      rowCount: results.length - 1, // Subtract header row
    });

    const response: any = {
      success: true,
      authMethod,
      query,
      rowCount: results.length - 1,
      data: results,
    };

    // Add OAuth-specific fields
    if (authMethod === 'OAUTH') {
      response.authenticatedUser = username;
      response.userGroups = userGroups;
      response.lfRole = roleArn;
    }

    return createSuccessResponse(response);
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
 * Parse request body
 */
function parseBody(event: APIGatewayProxyEvent): QueryRequest {
  try {
    return JSON.parse(event.body || '{}');
  } catch (error) {
    throw new LambdaError(400, 'Invalid JSON in request body');
  }
}

/**
 * Parse and validate request body (deprecated - kept for backwards compatibility)
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
