/**
 * Service for IAM role assumption
 */
import { STSClient, AssumeRoleCommand, Credentials } from '@aws-sdk/client-sts';
import { AssumedCredentials } from '../types';
import { Logger } from '../utils/logger';
import { LambdaError } from '../utils/errorHandler';

export class RoleService {
  private client: STSClient;
  private logger: Logger;

  constructor(region: string) {
    this.client = new STSClient({ region });
    this.logger = new Logger('RoleService');
  }

  /**
   * Assume the specified IAM role and return temporary credentials
   */
  async assumeRole(
    roleArn: string, 
    sessionName: string = 'lambda-session',
    durationSeconds: number = 3600
  ): Promise<AssumedCredentials> {
    try {
      this.logger.info('Assuming IAM role', { roleArn, sessionName });

      const command = new AssumeRoleCommand({
        RoleArn: roleArn,
        RoleSessionName: `lf-athena-${sessionName}`,
        DurationSeconds: durationSeconds,
      });

      const response = await this.client.send(command);

      if (!response.Credentials) {
        throw new Error('No credentials returned from AssumeRole');
      }

      const creds = response.Credentials as Credentials;

      if (!creds.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken) {
        throw new Error('Incomplete credentials returned');
      }

      this.logger.info('Successfully assumed role');

      return {
        accessKeyId: creds.AccessKeyId,
        secretAccessKey: creds.SecretAccessKey,
        sessionToken: creds.SessionToken,
      };
    } catch (error) {
      this.logger.error('Error assuming role', error as Error, { roleArn });
      throw new LambdaError(500, `Failed to assume role: ${(error as Error).message}`);
    }
  }
}
