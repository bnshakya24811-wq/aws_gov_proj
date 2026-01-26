# Lake Formation Athena Query Lambda (TypeScript)

TypeScript implementation of the Lambda handler for Athena queries with Lake Formation Tag-Based Access Control (TBAC).

## Architecture

This implementation follows a modular architecture with clear separation of concerns:

```
src/
├── index.ts                    # Main Lambda handler
├── config.ts                   # Environment configuration
├── types.ts                    # TypeScript type definitions
├── services/
│   ├── apiKeyService.ts        # DynamoDB API key → Role mapping
│   ├── roleService.ts          # STS role assumption
│   └── athenaService.ts        # Athena query execution
└── utils/
    ├── errorHandler.ts         # Error handling & responses
    └── logger.ts               # Structured logging
```

## Features

- **Type Safety**: Full TypeScript with strict type checking
- **Modular Design**: Separate services for each AWS interaction
- **Structured Logging**: JSON-formatted logs with context
- **Error Handling**: Custom error types with proper status codes
- **AWS SDK v3**: Modern AWS SDK with tree-shaking support
- **Async/Await**: Clean asynchronous code flow

## Service Modules

### ApiKeyService
- Looks up IAM role ARN from DynamoDB using API key
- Validates mapping exists and contains required fields
- Throws appropriate errors for missing/invalid keys

### RoleService
- Assumes IAM role using STS
- Returns temporary credentials for Athena queries
- Handles credential validation

### AthenaService
- Starts query execution with assumed credentials
- Polls for query completion with timeout
- Retrieves paginated results
- Enforces Lake Formation permissions via assumed role

## Build & Deploy

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Package for Lambda deployment
npm run package

# Clean build artifacts
npm run clean
```

## Environment Variables

Required environment variables (set by CloudFormation):

- `API_KEY_TABLE` - DynamoDB table name for API key mappings
- `DATABASE_NAME` - Glue database name
- `ATHENA_OUTPUT_BUCKET` - S3 bucket for Athena query results
- `REGION` - AWS region (e.g., us-east-1)
- `LOG_LEVEL` - (Optional) Set to 'DEBUG' for verbose logging

## Request/Response Format

### Request
```json
{
  "tableName": "lf_lh_silver_bkt_o_sp5_dev",
  "limit": 5
}
```

### Success Response
```json
{
  "success": true,
  "query": "SELECT * FROM \"database\".\"table\" LIMIT 5",
  "rowCount": 5,
  "data": [
    ["member_id", "ssn"],
    ["1001", "123-45-6789"],
    ...
  ]
}
```

### Error Response
```json
{
  "success": false,
  "error": "Invalid API key"
}
```

## Testing

### Test with Super User API Key (Full PII Access)
```bash
curl -X POST https://API_ENDPOINT/dev/query \
  -H "x-api-key: lPhl4UQwde7lcfWs1xLag1lX6BYoclGR8lk2FjUp" \
  -H "Content-Type: application/json" \
  -d '{"tableName": "lf_lh_silver_bkt_o_sp5_dev", "limit": 5}'
```

### Test with Dev User API Key (Restricted - No PII)
```bash
curl -X POST https://API_ENDPOINT/dev/query \
  -H "x-api-key: y0cTvXBvoH44hlxezvJTlgN55AmIdh13KSIeYp50" \
  -H "Content-Type: application/json" \
  -d '{"tableName": "lf_lh_silver_bkt_o_sp5_dev", "limit": 5}'
```

## Logging

All services use structured JSON logging:

```json
{
  "level": "INFO",
  "context": "AthenaService",
  "message": "Query started successfully",
  "queryExecutionId": "abc-123",
  "timestamp": "2026-01-25T10:30:00.000Z"
}
```

Log levels: `INFO`, `WARN`, `ERROR`, `DEBUG`

## Error Handling

Custom `LambdaError` class for known errors:

- `400` - Invalid request (missing params, invalid JSON)
- `403` - Invalid API key
- `500` - AWS service errors, query failures, timeouts

All errors are logged with full context and stack traces.

## Development

Add new functionality by creating additional service modules:

1. Create service class in `src/services/`
2. Define types in `src/types.ts`
3. Initialize service in `index.ts` handler
4. Add error handling with `LambdaError`
5. Add structured logging with `Logger`

## Comparison with Python Version

| Feature | Python | TypeScript |
|---------|--------|------------|
| Type Safety | Runtime only | Compile-time + Runtime |
| Modularity | Single file | Multiple modules |
| Logging | Print statements | Structured JSON |
| Error Handling | Basic | Custom error types |
| AWS SDK | boto3 | @aws-sdk v3 |
| Code Size | ~256 lines | ~700 lines (better separation) |
| Maintainability | Good | Excellent |
