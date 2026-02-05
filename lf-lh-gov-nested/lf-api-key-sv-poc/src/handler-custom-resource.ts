/**
 * CloudFormation Custom Resource Handler
 * Processes API key mappings and stores them in Secrets Manager and DynamoDB
 */
import { CustomResourceEvent, CustomResourceContext } from './types-custom-resource';
import { CustomResourceService } from './services/customResourceService';
import { sendSuccess, sendFailure } from './utils/cfnResponse';
import { Logger } from './utils/logger';

const logger = new Logger('CustomResourceHandler');

/**
 * Main handler for CloudFormation custom resource
 */
export const handler = async (
  event: CustomResourceEvent,
  context: CustomResourceContext
): Promise<void> => {
  logger.info('Custom resource invocation started', {
    requestType: event.RequestType,
    requestId: event.RequestId,
    logicalResourceId: event.LogicalResourceId,
  });

  const service = new CustomResourceService(process.env.AWS_REGION || 'us-east-1');

  try {
    const { RequestType, ResourceProperties } = event;

    if (RequestType === 'Delete') {
      // Cleanup secrets on stack deletion
      logger.info('Processing Delete request');
      
      try {
        await service.deleteSecrets(ResourceProperties.APIKeyMappings);
      } catch (error) {
        // Log but don't fail on cleanup errors
        logger.warn('Cleanup warning', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      await sendSuccess(event, context, {}, event.PhysicalResourceId);
      return;
    }

    // Process Create/Update
    logger.info(`Processing ${RequestType} request`, {
      mappingsCount: ResourceProperties.APIKeyMappings.length,
      tableName: ResourceProperties.TableName,
      environment: ResourceProperties.Environment,
      version: ResourceProperties.Version,
    });

    const responseData = await service.processAPIKeyMappings(
      ResourceProperties.APIKeyMappings,
      ResourceProperties.TableName,
      ResourceProperties.Environment
    );

    await sendSuccess(
      event,
      context,
      responseData,
      event.PhysicalResourceId || context.awsRequestId
    );

    logger.info('Custom resource processing completed successfully');
  } catch (error) {
    logger.error(
      'Custom resource processing failed',
      error instanceof Error ? error : new Error(String(error))
    );

    await sendFailure(
      event,
      context,
      error instanceof Error ? error : new Error(String(error)),
      event.PhysicalResourceId || context.awsRequestId
    );
  }
};
