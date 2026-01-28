/**
 * Service for Athena query execution with Lake Formation permissions
 */
import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  QueryExecutionState,
} from '@aws-sdk/client-athena';
import { AssumedCredentials, QueryStatus } from '../types';
import { Logger } from '../utils/logger';
import { LambdaError } from '../utils/errorHandler';

export class AthenaService {
  private logger: Logger;
  private region: string;
  private databaseName: string;
  private outputLocation: string;

  constructor(region: string, databaseName: string, outputLocation: string) {
    this.region = region;
    this.databaseName = databaseName;
    this.outputLocation = outputLocation;
    this.logger = new Logger('AthenaService');
  }

  /**
   * Create Athena client with assumed credentials
   */
  private getClient(credentials: AssumedCredentials): AthenaClient {
    return new AthenaClient({
      region: this.region,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
    });
  }

  /**
   * Build SQL query string
   */
  private buildQuery(tableName: string, limit: number): string {
    // Wrap database and table names in double quotes to handle hyphens
    return `SELECT * FROM "${this.databaseName}"."${tableName}" LIMIT ${limit}`;
  }

  /**
   * Start an Athena query execution
   */
  async startQuery(
    tableName: string,
    limit: number,
    credentials: AssumedCredentials
  ): Promise<string> {
    try {
      const query = this.buildQuery(tableName, limit);
      this.logger.info('Starting Athena query', { query });

      const client = this.getClient(credentials);
      const command = new StartQueryExecutionCommand({
        QueryString: query,
        QueryExecutionContext: {
          Database: this.databaseName,
        },
        ResultConfiguration: {
          OutputLocation: this.outputLocation,
        },
        WorkGroup: 'primary',
      });

      const response = await client.send(command);

      if (!response.QueryExecutionId) {
        throw new Error('No QueryExecutionId returned');
      }

      this.logger.info('Query started successfully', {
        queryExecutionId: response.QueryExecutionId,
      });

      return response.QueryExecutionId;
    } catch (error) {
      this.logger.error('Error starting Athena query', error as Error);
      throw new LambdaError(500, `Failed to start query: ${(error as Error).message}`);
    }
  }

  /**
   * Wait for query to complete
   */
  async waitForQueryCompletion(
    queryExecutionId: string,
    credentials: AssumedCredentials,
    maxWaitSeconds: number = 60
  ): Promise<QueryExecutionState> {
    try {
      this.logger.info('Waiting for query completion', { queryExecutionId });

      const client = this.getClient(credentials);
      const startTime = Date.now();

      while (true) {
        const command = new GetQueryExecutionCommand({ QueryExecutionId: queryExecutionId });
        const response = await client.send(command);

        const status = response.QueryExecution?.Status?.State;

        if (!status) {
          throw new Error('No query status returned');
        }

        this.logger.debug('Query status', { status, queryExecutionId });

        if (
          status === QueryExecutionState.SUCCEEDED ||
          status === QueryExecutionState.FAILED ||
          status === QueryExecutionState.CANCELLED
        ) {
          this.logger.info('Query completed', { status, queryExecutionId });
          return status;
        }

        const elapsedSeconds = (Date.now() - startTime) / 1000;
        if (elapsedSeconds > maxWaitSeconds) {
          this.logger.warn('Query timeout', { queryExecutionId, elapsedSeconds });
          throw new LambdaError(500, 'Query execution timeout');
        }

        // Wait 1 second before next poll
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      if (error instanceof LambdaError) {
        throw error;
      }
      this.logger.error('Error waiting for query', error as Error);
      throw new LambdaError(500, `Query execution failed: ${(error as Error).message}`);
    }
  }

  /**
   * Get query results
   */
  async getQueryResults(
    queryExecutionId: string,
    credentials: AssumedCredentials
  ): Promise<string[][]> {
    try {
      this.logger.info('Retrieving query results', { queryExecutionId });

      const client = this.getClient(credentials);
      const results: string[][] = [];
      let nextToken: string | undefined;

      do {
        const command = new GetQueryResultsCommand({
          QueryExecutionId: queryExecutionId,
          NextToken: nextToken,
        });

        const response = await client.send(command);

        // Extract rows
        if (response.ResultSet?.Rows) {
          for (const row of response.ResultSet.Rows) {
            const rowData = row.Data?.map((field) => field.VarCharValue || '') || [];
            results.push(rowData);
          }
        }

        nextToken = response.NextToken;
      } while (nextToken);

      this.logger.info('Retrieved query results', {
        rowCount: results.length,
        queryExecutionId,
      });

      return results;
    } catch (error) {
      this.logger.error('Error getting query results', error as Error);
      throw new LambdaError(500, `Failed to retrieve results: ${(error as Error).message}`);
    }
  }

  /**
   * Execute complete query workflow
   */
  async executeQuery(
    tableName: string,
    limit: number,
    credentials: AssumedCredentials
  ): Promise<{ query: string; results: string[][] }> {
    const queryExecutionId = await this.startQuery(tableName, limit, credentials);
    const status = await this.waitForQueryCompletion(queryExecutionId, credentials);

    if (status !== QueryExecutionState.SUCCEEDED) {
      throw new LambdaError(500, `Query failed with status: ${status}`);
    }

    const results = await this.getQueryResults(queryExecutionId, credentials);
    const query = this.buildQuery(tableName, limit);

    return { query, results };
  }

  /**
   * Execute raw SQL query (for OAuth)
   */
  async executeRawQuery(
    sqlQuery: string,
    credentials: AssumedCredentials
  ): Promise<{ query: string; results: string[][] }> {
    try {
      this.logger.info('Starting raw SQL query', { query: sqlQuery });

      const client = this.getClient(credentials);
      const command = new StartQueryExecutionCommand({
        QueryString: sqlQuery,
        QueryExecutionContext: {
          Database: this.databaseName,
        },
        ResultConfiguration: {
          OutputLocation: this.outputLocation,
        },
        WorkGroup: 'primary',
      });

      const response = await client.send(command);

      if (!response.QueryExecutionId) {
        throw new Error('No QueryExecutionId returned');
      }

      const queryExecutionId = response.QueryExecutionId;
      this.logger.info('Raw query started successfully', { queryExecutionId });

      const status = await this.waitForQueryCompletion(queryExecutionId, credentials);

      if (status !== QueryExecutionState.SUCCEEDED) {
        throw new LambdaError(500, `Query failed with status: ${status}`);
      }

      const results = await this.getQueryResults(queryExecutionId, credentials);

      return { query: sqlQuery, results };
    } catch (error) {
      if (error instanceof LambdaError) {
        throw error;
      }
      this.logger.error('Error executing raw query', error as Error);
      throw new LambdaError(500, `Failed to execute query: ${(error as Error).message}`);
    }
  }
}
