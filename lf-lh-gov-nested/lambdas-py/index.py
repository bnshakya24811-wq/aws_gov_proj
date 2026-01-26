"""
Lambda handler for Athena queries with Lake Formation permissions.
Maps API key to IAM role, assumes role, and executes query with LF TBAC.
"""
import json
import boto3
import os
import time
from typing import Dict, Any, Optional

# Environment variables
API_KEY_TABLE = os.environ['API_KEY_TABLE']
DATABASE_NAME = os.environ['DATABASE_NAME']
ATHENA_OUTPUT_BUCKET = os.environ['ATHENA_OUTPUT_BUCKET']
REGION = os.environ['REGION']

# AWS clients
dynamodb = boto3.resource('dynamodb', region_name=REGION)
sts_client = boto3.client('sts', region_name=REGION)


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main Lambda handler.
    
    Expected API Gateway event body:
    {
        "tableName": "members",
        "limit": 10  // optional
    }
    
    API Key is passed via x-api-key header (handled by API Gateway)
    """
    try:
        # Extract API key from headers
        api_key = event.get('headers', {}).get('x-api-key') or event.get('headers', {}).get('X-Api-Key')
        
        if not api_key:
            return error_response(400, "Missing API key")
        
        # Parse request body
        try:
            body = json.loads(event.get('body', '{}'))
        except json.JSONDecodeError:
            return error_response(400, "Invalid JSON in request body")
        
        table_name = body.get('tableName')
        limit = body.get('limit', 100)
        
        if not table_name:
            return error_response(400, "Missing required parameter: tableName")
        
        # Validate limit
        if not isinstance(limit, int) or limit < 1 or limit > 1000:
            return error_response(400, "limit must be between 1 and 1000")
        
        # Lookup IAM role for this API key
        role_arn = get_role_for_api_key(api_key)
        if not role_arn:
            return error_response(403, "Invalid API key")
        
        # Assume the role
        assumed_credentials = assume_role(role_arn)
        if not assumed_credentials:
            return error_response(500, "Failed to assume role")
        
        # Execute Athena query with assumed credentials
        # Wrap database and table names in double quotes to handle hyphens
        query = f'SELECT * FROM "{DATABASE_NAME}"."{table_name}" LIMIT {limit}'
        
        query_execution_id = start_athena_query(query, assumed_credentials)
        if not query_execution_id:
            return error_response(500, "Failed to start query")
        
        # Wait for query to complete
        query_status = wait_for_query_completion(query_execution_id, assumed_credentials)
        
        if query_status != 'SUCCEEDED':
            return error_response(500, f"Query failed with status: {query_status}")
        
        # Get query results
        results = get_query_results(query_execution_id, assumed_credentials)
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'success': True,
                'query': query,
                'rowCount': len(results) - 1,  # Subtract header row
                'data': results
            })
        }
        
    except Exception as e:
        print(f"Unexpected error: {str(e)}")
        import traceback
        traceback.print_exc()
        return error_response(500, f"Internal server error: {str(e)}")


def get_role_for_api_key(api_key: str) -> Optional[str]:
    """Look up IAM role ARN for the given API key in DynamoDB."""
    try:
        table = dynamodb.Table(API_KEY_TABLE)
        response = table.get_item(Key={'apiKey': api_key})
        
        if 'Item' in response:
            return response['Item'].get('roleArn')
        return None
    except Exception as e:
        print(f"Error querying DynamoDB: {str(e)}")
        return None


def assume_role(role_arn: str) -> Optional[Dict[str, str]]:
    """Assume the specified IAM role and return temporary credentials."""
    try:
        response = sts_client.assume_role(
            RoleArn=role_arn,
            RoleSessionName='athena-query-session',
            DurationSeconds=3600
        )
        
        credentials = response['Credentials']
        return {
            'aws_access_key_id': credentials['AccessKeyId'],
            'aws_secret_access_key': credentials['SecretAccessKey'],
            'aws_session_token': credentials['SessionToken']
        }
    except Exception as e:
        print(f"Error assuming role {role_arn}: {str(e)}")
        return None


def start_athena_query(query: str, credentials: Dict[str, str]) -> Optional[str]:
    """Start an Athena query using assumed credentials."""
    try:
        athena_client = boto3.client(
            'athena',
            region_name=REGION,
            aws_access_key_id=credentials['aws_access_key_id'],
            aws_secret_access_key=credentials['aws_secret_access_key'],
            aws_session_token=credentials['aws_session_token']
        )
        
        response = athena_client.start_query_execution(
            QueryString=query,
            QueryExecutionContext={
                'Database': DATABASE_NAME
            },
            ResultConfiguration={
                'OutputLocation': ATHENA_OUTPUT_BUCKET
            },
            WorkGroup='primary'
        )
        
        return response['QueryExecutionId']
    except Exception as e:
        print(f"Error starting Athena query: {str(e)}")
        return None


def wait_for_query_completion(query_execution_id: str, credentials: Dict[str, str], 
                               max_wait_seconds: int = 60) -> str:
    """Wait for Athena query to complete and return final status."""
    try:
        athena_client = boto3.client(
            'athena',
            region_name=REGION,
            aws_access_key_id=credentials['aws_access_key_id'],
            aws_secret_access_key=credentials['aws_secret_access_key'],
            aws_session_token=credentials['aws_session_token']
        )
        
        start_time = time.time()
        
        while True:
            response = athena_client.get_query_execution(
                QueryExecutionId=query_execution_id
            )
            
            status = response['QueryExecution']['Status']['State']
            
            if status in ['SUCCEEDED', 'FAILED', 'CANCELLED']:
                return status
            
            if time.time() - start_time > max_wait_seconds:
                return 'TIMEOUT'
            
            time.sleep(1)
            
    except Exception as e:
        print(f"Error waiting for query: {str(e)}")
        return 'ERROR'


def get_query_results(query_execution_id: str, credentials: Dict[str, str]) -> list:
    """Retrieve results from completed Athena query."""
    try:
        athena_client = boto3.client(
            'athena',
            region_name=REGION,
            aws_access_key_id=credentials['aws_access_key_id'],
            aws_secret_access_key=credentials['aws_secret_access_key'],
            aws_session_token=credentials['aws_session_token']
        )
        
        results = []
        next_token = None
        
        while True:
            if next_token:
                response = athena_client.get_query_results(
                    QueryExecutionId=query_execution_id,
                    NextToken=next_token
                )
            else:
                response = athena_client.get_query_results(
                    QueryExecutionId=query_execution_id
                )
            
            # Extract rows
            for row in response['ResultSet']['Rows']:
                row_data = [field.get('VarCharValue', '') for field in row['Data']]
                results.append(row_data)
            
            # Check for more pages
            next_token = response.get('NextToken')
            if not next_token:
                break
        
        return results
        
    except Exception as e:
        print(f"Error getting query results: {str(e)}")
        return []


def error_response(status_code: int, message: str) -> Dict[str, Any]:
    """Generate error response."""
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        'body': json.dumps({
            'success': False,
            'error': message
        })
    }
