/**
 * Error handling utilities
 */
import { APIGatewayProxyResult } from 'aws-lambda';
import { ErrorResponse } from '../types';

export const createErrorResponse = (
  statusCode: number,
  message: string
): APIGatewayProxyResult => {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      success: false,
      error: message,
    }),
  };
};

export const createSuccessResponse = (data: unknown): APIGatewayProxyResult => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(data),
  };
};

export class LambdaError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'LambdaError';
  }
}
