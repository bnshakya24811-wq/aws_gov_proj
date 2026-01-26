/**
 * Service for mapping IAM user ARNs to Lake Formation role ARNs
 */
import { Logger } from '../utils/logger';

const logger = new Logger('IAMUserService');

export class IAMUserService {
  // Static mapping of IAM user ARNs to LF role ARNs
  // In production, this could be stored in DynamoDB or Parameter Store
  private static readonly IAM_USER_TO_ROLE_MAP: Record<string, string> = {
    // Dev User - limited permissions (no PII access)
    'arn:aws:iam::441203120895:user/lf-lh-dev-user-o-sp5-dev':
      'arn:aws:iam::441203120895:role/lf-lh-dev-user-role-o-sp6-dev',
    
    // Super User - full permissions (PII access)
    'arn:aws:iam::441203120895:user/lf-lh-super-user-o-sp5-dev':
      'arn:aws:iam::441203120895:role/lf-lh-super-user-role-o-sp6-dev',
  };

  /**
   * Get Lake Formation role ARN for an IAM user ARN
   */
  getRoleForIAMUser(userArn: string): string {
    logger.info('Looking up LF role for IAM user', { userArn });

    const roleArn = IAMUserService.IAM_USER_TO_ROLE_MAP[userArn];

    if (!roleArn) {
      logger.warn('IAM user not authorized', { userArn });
      throw new Error(`IAM user not authorized: ${userArn}`);
    }

    logger.info('Found LF role for IAM user', { userArn, roleArn });
    return roleArn;
  }
}
