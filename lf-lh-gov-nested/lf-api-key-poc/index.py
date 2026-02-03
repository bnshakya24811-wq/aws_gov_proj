"""
Lambda handler with secret scanning + DynamoDB lookup
Scans secrets with lf-apikey-* pattern, finds match, then looks up role in DynamoDB
"""
import json
import os
import boto3
from botocore.exceptions import ClientError

secretsmanager = boto3.client('secretsmanager')
dynamodb = boto3.client('dynamodb')
sts = boto3.client('sts')
athena = boto3.client('athena')
s3 = boto3.client('s3')

DYNAMODB_TABLE = os.environ['DYNAMODB_TABLE']
ENVIRONMENT = os.environ['ENVIRONMENT']
ATHENA_OUTPUT_BUCKET = os.environ['ATHENA_OUTPUT_BUCKET']
ATHENA_OUTPUT_PREFIX = os.environ.get('ATHENA_OUTPUT_PREFIX', 'query-results/')


def handler(event, context):
    """
    Main Lambda handler with secret scanning + DynamoDB lookup
    
    Flow:
    1. Extract API key from headers (x-api-key)
    2. List secrets with naming pattern "lf-apikey-*-{env}"
    3. Check each secret's value for match with incoming API key
    4. Use matched secret name to lookup DynamoDB
    5. Get roleArn from DynamoDB
    6. Assume role & execute Athena query
    """
    try:
        # Extract API key from headers (mandatory)
        headers = event.get('headers', {})
        api_key = headers.get('x-api-key') or headers.get('X-API-Key')
        
        if not api_key:
            return create_response(401, {'error': 'Missing required x-api-key header'})
        
        print(f"Searching for API key match in secrets with pattern: lf-apikey-*-{ENVIRONMENT}")
        
        # List secrets with our naming pattern
        try:
            list_response = secretsmanager.list_secrets(
                Filters=[
                    {'Key': 'name', 'Values': [f'lf-apikey-']},
                    {'Key': 'tag-key', 'Values': ['LFAPIKeyType']}
                ],
                MaxResults=20
            )
        except ClientError as e:
            print(f"Error listing secrets: {e}")
            return create_response(500, {'error': 'Secret listing failed'})
        
        # Check each secret for matching API key
        matched_secret_name = None
        user_name = None
        
        for secret_metadata in list_response.get('SecretList', []):
            secret_name = secret_metadata['Name']
            
            # Only check secrets for our environment
            if not secret_name.endswith(f'-{ENVIRONMENT}'):
                continue
            
            try:
                secret_response = secretsmanager.get_secret_value(SecretId=secret_name)
                secret_data = json.loads(secret_response['SecretString'])
                
                # Check if API key matches
                if secret_data.get('apiKey') == api_key:
                    matched_secret_name = secret_name
                    user_name = secret_data.get('userName', 'unknown')
                    print(f"Found matching API key in secret: {secret_name}, user: {user_name}")
                    break
                    
            except ClientError as e:
                print(f"Error reading secret {secret_name}: {e}")
                continue
        
        # If no match found in secrets
        if not matched_secret_name:
            print(f"No matching API key found in secrets")
            return create_response(403, {'error': 'Invalid API key'})
        
        # Lookup role ARN in DynamoDB using secret name
        print(f"Looking up DynamoDB mapping for secret: {matched_secret_name}")
        try:
            dynamo_response = dynamodb.get_item(
                TableName=DYNAMODB_TABLE,
                Key={'secretName': {'S': matched_secret_name}}
            )
        except ClientError as e:
            print(f"DynamoDB error: {e}")
            return create_response(500, {'error': 'Database lookup failed'})
        
        if 'Item' not in dynamo_response:
            print(f"No DynamoDB mapping found for secret: {matched_secret_name}")
            return create_response(500, {'error': 'Configuration error: missing role mapping'})
        
        role_arn = dynamo_response['Item']['roleArn']['S']
        print(f"Found role mapping: user={user_name}, role={role_arn}")
        
        # Parse request body
        body = json.loads(event.get('body', '{}'))
        table_name = body.get('tableName')
        database = body.get('database')
        query = body.get('query')
        limit = body.get('limit', 10)
        
        # Validate request
        if not table_name and not query:
            return create_response(400, {'error': 'Provide either tableName or query'})
        
        if query and not database:
            return create_response(400, {'error': 'database required when using custom query'})
        
        # Build query if not provided
        if not query:
            database = database or 'default'
            query = f"SELECT * FROM {database}.{table_name} LIMIT {limit}"
        
        # Assume the role
        print(f"Assuming role: {role_arn}")
        try:
            assume_response = sts.assume_role(
                RoleArn=role_arn,
                RoleSessionName=f"lf-athena-session-{user_name}",
                DurationSeconds=3600
            )
            credentials = assume_response['Credentials']
        except ClientError as e:
            print(f"AssumeRole error: {e}")
            return create_response(500, {'error': 'Failed to assume role'})
        
        # Create Athena client with assumed credentials
        athena_assumed = boto3.client(
            'athena',
            aws_access_key_id=credentials['AccessKeyId'],
            aws_secret_access_key=credentials['SecretAccessKey'],
            aws_session_token=credentials['SessionToken']
        )
        
        # Execute Athena query
        print(f"Executing query: {query}")
        query_execution_id = start_athena_query(athena_assumed, query, database)
        
        # Wait for query completion
        results = wait_for_query_completion(athena_assumed, query_execution_id)
        
        return create_response(200, {
            'message': 'Query executed successfully',
            'user': user_name,
            'queryExecutionId': query_execution_id,
            'results': results
        })
        
    except Exception as e:
        print(f"Unexpected error: {str(e)}")
        return create_response(500, {'error': str(e)})


def start_athena_query(athena_client, query, database):
    """Start Athena query execution"""
    # Ensure proper S3 path format with trailing slash
    output_location = f"s3://{ATHENA_OUTPUT_BUCKET}/{ATHENA_OUTPUT_PREFIX}"
    if not output_location.endswith('/'):
        output_location += '/'
    
    print(f"Athena output location: {output_location}")
    
    response = athena_client.start_query_execution(
        QueryString=query,
        QueryExecutionContext={'Database': database},
        ResultConfiguration={
            'OutputLocation': output_location
        }
    )
    return response['QueryExecutionId']


def wait_for_query_completion(athena_client, query_execution_id, max_wait=60):
    """Wait for Athena query to complete and return results"""
    import time
    
    waited = 0
    while waited < max_wait:
        response = athena_client.get_query_execution(
            QueryExecutionId=query_execution_id
        )
        state = response['QueryExecution']['Status']['State']
        
        if state == 'SUCCEEDED':
            # Get query results
            results_response = athena_client.get_query_results(
                QueryExecutionId=query_execution_id,
                MaxResults=100
            )
            return format_results(results_response)
        
        elif state in ['FAILED', 'CANCELLED']:
            reason = response['QueryExecution']['Status'].get('StateChangeReason', 'Unknown')
            raise Exception(f"Query {state}: {reason}")
        
        time.sleep(2)
        waited += 2
    
    raise Exception(f"Query timeout after {max_wait} seconds")


def format_results(results_response):
    """Format Athena results into readable JSON"""
    rows = results_response['ResultSet']['Rows']
    
    if len(rows) < 2:
        return []
    
    # Extract column names
    columns = [col['VarCharValue'] for col in rows[0]['Data']]
    
    # Extract data rows
    data = []
    for row in rows[1:]:
        row_data = {}
        for i, col in enumerate(row['Data']):
            row_data[columns[i]] = col.get('VarCharValue', '')
        data.append(row_data)
    
    return data


def create_response(status_code, body):
    """Create HTTP response"""
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key',
            'Access-Control-Allow-Methods': 'POST,OPTIONS'
        },
        'body': json.dumps(body)
    }
