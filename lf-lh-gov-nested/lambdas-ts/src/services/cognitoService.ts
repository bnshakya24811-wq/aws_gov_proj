/**
 * Cognito Service - Handles OAuth 2.0 authentication with AWS Cognito
 */
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  GetUserCommand,
  AdminListGroupsForUserCommand,
  AuthFlowType,
} from '@aws-sdk/client-cognito-identity-provider';
import { createHmac } from 'crypto';
import { Logger } from '../utils/logger';
import { LambdaError } from '../utils/errorHandler';

const logger = new Logger('CognitoService');

export interface AuthenticationResult {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  expiresIn: number;
}

export interface UserInfo {
  username: string;
  email?: string;
  groups: string[];
  attributes: Record<string, string>;
}

export class CognitoService {
  private client: CognitoIdentityProviderClient;
  private userPoolId: string;
  private clientId: string;
  private clientSecret: string;

  constructor(
    region: string,
    userPoolId: string,
    clientId: string,
    clientSecret: string
  ) {
    this.client = new CognitoIdentityProviderClient({ region });
    this.userPoolId = userPoolId;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  /**
   * Authenticate user with username and password
   */
  async authenticateUser(
    username: string,
    password: string
  ): Promise<AuthenticationResult> {
    try {
      const secretHash = this.calculateSecretHash(username);

      const command = new InitiateAuthCommand({
        ClientId: this.clientId,
        AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
        AuthParameters: {
          USERNAME: username,
          PASSWORD: password,
          SECRET_HASH: secretHash,
        },
      });

      const response = await this.client.send(command);

      if (!response.AuthenticationResult) {
        throw new LambdaError(401, 'Authentication failed');
      }

      const authResult = response.AuthenticationResult;

      logger.info('User authenticated successfully', { username });

      return {
        accessToken: authResult.AccessToken!,
        idToken: authResult.IdToken!,
        refreshToken: authResult.RefreshToken,
        expiresIn: authResult.ExpiresIn!,
      };
    } catch (error: any) {
      if (error.name === 'NotAuthorizedException') {
        logger.warn('Authentication failed - invalid credentials', { username });
        throw new LambdaError(401, 'Invalid username or password');
      }
      logger.error('Cognito authentication error', error);
      throw new LambdaError(500, `Authentication error: ${error.message}`);
    }
  }

  /**
   * Get user information from access token
   */
  async getUserInfo(accessToken: string): Promise<UserInfo> {
    try {
      // Get user details
      const getUserCommand = new GetUserCommand({
        AccessToken: accessToken,
      });

      const userResponse = await this.client.send(getUserCommand);

      const username = userResponse.Username!;
      const attributes: Record<string, string> = {};

      // Parse user attributes
      if (userResponse.UserAttributes) {
        for (const attr of userResponse.UserAttributes) {
          if (attr.Name && attr.Value) {
            attributes[attr.Name] = attr.Value;
          }
        }
      }

      // Get user groups
      let groups: string[] = [];
      try {
        const groupsCommand = new AdminListGroupsForUserCommand({
          Username: username,
          UserPoolId: this.userPoolId,
        });

        const groupsResponse = await this.client.send(groupsCommand);
        groups = groupsResponse.Groups?.map((g) => g.GroupName!) || [];
      } catch (error: any) {
        logger.warn('Could not retrieve user groups', {
          username,
          error: error.message,
        });
      }

      logger.info('Retrieved user info', { username, groups });

      return {
        username,
        email: attributes['email'],
        groups,
        attributes,
      };
    } catch (error: any) {
      logger.error('Failed to get user info', error);
      throw new LambdaError(500, `Failed to retrieve user information: ${error.message}`);
    }
  }

  /**
   * Map Cognito user groups to Lake Formation role ARN
   */
  mapUserToLFRole(userInfo: UserInfo, devRoleArn: string, superRoleArn: string): string {
    const { groups } = userInfo;

    // Admin or Admins group → Super User role
    if (groups.includes('Admins') || groups.includes('Admin')) {
      logger.info('Mapping user to Super User role', {
        username: userInfo.username,
        group: 'Admins',
      });
      return superRoleArn;
    }

    // All other groups (Developers, Analysts, DataScientists) → Dev User role
    logger.info('Mapping user to Dev User role', {
      username: userInfo.username,
      groups,
    });
    return devRoleArn;
  }

  /**
   * Calculate SECRET_HASH required for Cognito authentication
   */
  private calculateSecretHash(username: string): string {
    const message = username + this.clientId;
    const hmac = createHmac('sha256', this.clientSecret);
    hmac.update(message);
    return hmac.digest('base64');
  }
}
