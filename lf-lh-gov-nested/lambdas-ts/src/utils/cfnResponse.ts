/**
 * CloudFormation Custom Resource Response Utility
 * Handles sending responses back to CloudFormation via pre-signed S3 URL
 */
import https from 'https';
import url from 'url';
import { CustomResourceEvent, CustomResourceResponse, CustomResourceStatus, CustomResourceContext } from '../types-custom-resource';
import { Logger } from './logger';

const logger = new Logger('CFNResponse');

/**
 * Send response to CloudFormation
 */
export async function sendResponse(
  event: CustomResourceEvent,
  context: CustomResourceContext,
  status: CustomResourceStatus,
  data?: Record<string, any>,
  physicalResourceId?: string,
  reason?: string
): Promise<void> {
  const responseBody: CustomResourceResponse = {
    Status: status,
    Reason: reason || `See CloudWatch Log Stream: ${context.logStreamName}`,
    PhysicalResourceId: physicalResourceId || context.awsRequestId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: data,
  };

  logger.info('Sending CloudFormation response', {
    status,
    physicalResourceId: responseBody.PhysicalResourceId,
    data,
  });

  const responseBodyStr = JSON.stringify(responseBody);
  const parsedUrl = url.parse(event.ResponseURL);

  const options: https.RequestOptions = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.path,
    method: 'PUT',
    headers: {
      'Content-Type': '',
      'Content-Length': responseBodyStr.length,
    },
  };

  return new Promise((resolve, reject) => {
    const request = https.request(options, (response) => {
      logger.info('CloudFormation response sent', {
        statusCode: response.statusCode,
        statusMessage: response.statusMessage,
      });
      resolve();
    });

    request.on('error', (error) => {
      logger.error('Failed to send CloudFormation response', error);
      reject(error);
    });

    request.write(responseBodyStr);
    request.end();
  });
}

/**
 * Send success response
 */
export async function sendSuccess(
  event: CustomResourceEvent,
  context: CustomResourceContext,
  data?: Record<string, any>,
  physicalResourceId?: string
): Promise<void> {
  return sendResponse(event, context, CustomResourceStatus.SUCCESS, data, physicalResourceId);
}

/**
 * Send failure response
 */
export async function sendFailure(
  event: CustomResourceEvent,
  context: CustomResourceContext,
  error: Error | string,
  physicalResourceId?: string
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : error;
  return sendResponse(
    event,
    context,
    CustomResourceStatus.FAILED,
    { Error: errorMessage },
    physicalResourceId,
    errorMessage
  );
}
