"""
Lambda handler for OAuth 2.0 Proxy Pattern with AWS Cognito.
Client sends client_id + client_secret, Lambda handles OAuth token exchange.
"""
import json
import boto3
import os
import time
import base64
import hmac
import hashlib
from typing import Dict, Any, Optional
from botocore.exceptions import ClientError

# Environment variables
COGNITO_USER_POOL_ID = os.environ['COGNITO_USER_POOL_ID']
COGNITO_CLIENT_ID = os.environ['COGNITO_CLIENT_ID']
COGNITO_CLIENT_SECRET = os.environ['COGNITO_CLIENT_SECRET']
COGNITO_REGION = os.environ.get('COGNITO_REGION', os.environ['AWS_REGION'])
DATABASE_NAME = os.environ['DATABASE_NAME']
ATHENA_OUTPUT_BUCKET = os.environ['ATHENA_OUTPUT_BUCKET']
REGION = os.environ['REGION']
LF_DEV_ROLE_ARN = os.environ['LF_DEV_ROLE_ARN']
LF_SUPER_ROLE_ARN = os.environ['LF_SUPER_ROLE_ARN']

# AWS clients
cognito_client = boto3.client('cognito-idp', region_name=COGNITO_REGION)
sts_client = boto3.client('sts', region_name=REGION)

# Token cache (persists across warm Lambda invocations)
token_cache = {}


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    OAuth 2.0 Proxy Pattern handler.
    
    Expected request body:
    {
        "username": "dev-user",      // Cognito username
        "password": "Password123!",   // Cognito password
        "query": "SELECT * FROM members LIMIT 10"
    }
    
    Alternative (using client credentials if custom auth flow configured):
    {
        "client_id": "...",
        "client_secret": "...",
        "query": "SELECT * FROM members LIMIT 10"
    }
    """
    try:
        # Parse request body
        try:
            body = json.loads(event.get('body', '{}'))
        except json.JSONDecodeError:
            return error_response(400, "Invalid JSON in request body")
        
        # Extract authentication method
        username = body.get('username')
        password = body.get('password')
        query = body.get('query')
        
        if not query:
            return error_response(400, "Missing required parameter: query")
        
        # Step 1: Authenticate with Cognito and get tokens
        if username and password:
            auth_result = authenticate_user(username, password)
        else:
            return error_response(400, "Missing authentication credentials (username/password)")
        
        if not auth_result:
            return error_response(401, "Authentication failed - invalid credentials")
        
        # Step 2: Extract user attributes and determine role
        access_token = auth_result.get('AccessToken')
        id_token = auth_result.get('IdToken')
        
        # Get user attributes from token
        user_info = get_user_from_token(access_token)
        if not user_info:
            return error_response(500, "Failed to retrieve user information")
        
        # Step 3: Map Cognito user to Lake Formation role
        lf_role_arn = map_cognito_user_to_lf_role(user_info)
        
        print(f"✅ Authenticated user: {user_info.get('username')}, mapped to LF role: {lf_role_arn}")
        
        # Step 4: Assume Lake Formation role
        assumed_credentials = assume_role(lf_role_arn, user_info.get('username', 'unknown'))
        if not assumed_credentials:
            return error_response(500, "Failed to assume Lake Formation role")
        
        # Step 5: Execute Athena query with assumed credentials
        query_execution_id = start_athena_query(query, assumed_credentials)
        if not query_execution_id:
            return error_response(500, "Failed to start Athena query")
        
        # Step 6: Wait for query completion
        query_status = wait_for_query_completion(query_execution_id, assumed_credentials)
        
        if query_status != 'SUCCEEDED':
            error_info = get_query_error(query_execution_id, assumed_credentials)
            return error_response(500, f"Query failed: {error_info}")
        
        # Step 7: Get query results
        results = get_query_results(query_execution_id, assumed_credentials)
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'success': True,
                'authenticatedUser': user_info.get('username'),
                'userGroups': user_info.get('groups', []),
                'lfRole': lf_role_arn,
                'query': query,
                'rowCount': len(results) - 1,  # Subtract header row
                'data': results
            })
        }
        
    except Exception as e:
        print(f"❌ Unexpected error: {str(e)}")
        import traceback
        traceback.print_exc()
        return error_response(500, f"Internal server error: {str(e)}")


def authenticate_user(username: str, password: str) -> Optional[Dict[str, Any]]:
    """
    Authenticate user with Cognito using USER_PASSWORD_AUTH flow.
    Returns authentication result with tokens.
    """
    try:
        # Generate SECRET_HASH for authentication
        secret_hash = calculate_secret_hash(username, COGNITO_CLIENT_ID, COGNITO_CLIENT_SECRET)
        
        response = cognito_client.initiate_auth(
            ClientId=COGNITO_CLIENT_ID,
            AuthFlow='USER_PASSWORD_AUTH',
            AuthParameters={
                'USERNAME': username,
                'PASSWORD': password,
                'SECRET_HASH': secret_hash
            }
        )
        
        return response.get('AuthenticationResult')
        
    except cognito_client.exceptions.NotAuthorizedException:
        print(f"❌ Authentication failed for user: {username}")
        return None
    except ClientError as e:
        print(f"❌ Cognito error: {e.response['Error']['Message']}")
        return None


def calculate_secret_hash(username: str, client_id: str, client_secret: str) -> str:
    """
    Calculate SECRET_HASH required by Cognito for app clients with secret.
    """
    message = username + client_id
    secret = client_secret.encode('utf-8')
    signature = hmac.new(secret, message.encode('utf-8'), hashlib.sha256).digest()
    return base64.b64encode(signature).decode()


def get_user_from_token(access_token: str) -> Optional[Dict[str, Any]]:
    """
    Get user information from Cognito access token.
    """
    try:
        response = cognito_client.get_user(AccessToken=access_token)
        
        # Extract user attributes
        user_info = {
            'username': response['Username'],
            'attributes': {},
            'groups': []
        }
        
        for attr in response.get('UserAttributes', []):
            user_info['attributes'][attr['Name']] = attr['Value']
        
        # Get user groups (requires separate API call)
        try:
            groups_response = cognito_client.admin_list_groups_for_user(
                Username=response['Username'],
                UserPoolId=COGNITO_USER_POOL_ID
            )
            user_info['groups'] = [g['GroupName'] for g in groups_response.get('Groups', [])]
        except Exception as e:
            print(f"⚠️  Could not retrieve user groups: {str(e)}")
        
        return user_info
        
    except ClientError as e:
        print(f"❌ Failed to get user from token: {e.response['Error']['Message']}")
        return None


def map_cognito_user_to_lf_role(user_info: Dict[str, Any]) -> str:
    """
    Map Cognito user/groups to Lake Formation role ARN.
    
    Mapping logic:
    - Users in "Admins" or "SuperUsers" group → LF Super User role
    - Users in "Developers" or "Analysts" group → LF Dev User role
    - Default → LF Dev User role
    """
    groups = user_info.get('groups', [])
    username = user_info.get('username', '')
    
    # Check for admin/super user groups
    admin_groups = {'Admins', 'SuperUsers', 'DataEngineers'}
    if any(group in admin_groups for group in groups):
        print(f"🔑 User {username} in admin group, granting Super User role")
        return LF_SUPER_ROLE_ARN
    
    # Check for developer groups
    dev_groups = {'Developers', 'Analysts', 'DataScientists'}
    if any(group in dev_groups for group in groups):
        print(f"🔑 User {username} in dev group, granting Dev User role")
        return LF_DEV_ROLE_ARN
    
    # Check custom attribute for role mapping
    custom_role = user_info.get('attributes', {}).get('custom:lf_role')
    if custom_role == 'super':
        return LF_SUPER_ROLE_ARN
    
    # Default to dev user role
    print(f"🔑 User {username} using default Dev User role")
    return LF_DEV_ROLE_ARN


def assume_role(role_arn: str, session_name: str) -> Optional[Dict[str, str]]:
    """
    Assume IAM role and return temporary credentials.
    """
    try:
        response = sts_client.assume_role(
            RoleArn=role_arn,
            RoleSessionName=f"cognito-user-{session_name}",
            DurationSeconds=3600
        )
        
        credentials = response['Credentials']
        return {
            'AccessKeyId': credentials['AccessKeyId'],
            'SecretAccessKey': credentials['SecretAccessKey'],
            'SessionToken': credentials['SessionToken']
        }
    except ClientError as e:
        print(f"❌ Failed to assume role {role_arn}: {e.response['Error']['Message']}")
        return None


def start_athena_query(query: str, credentials: Dict[str, str]) -> Optional[str]:
    """
    Start Athena query execution with assumed role credentials.
    """
    try:
        athena_client = boto3.client(
            'athena',
            region_name=REGION,
            aws_access_key_id=credentials['AccessKeyId'],
            aws_secret_access_key=credentials['SecretAccessKey'],
            aws_session_token=credentials['SessionToken']
        )
        
        response = athena_client.start_query_execution(
            QueryString=query,
            QueryExecutionContext={'Database': DATABASE_NAME},
            ResultConfiguration={
                'OutputLocation': f's3://{ATHENA_OUTPUT_BUCKET}/oauth-queries/'
            }
        )
        
        return response['QueryExecutionId']
        
    except ClientError as e:
        print(f"❌ Athena query failed: {e.response['Error']['Message']}")
        return None


def wait_for_query_completion(query_execution_id: str, credentials: Dict[str, str], max_wait: int = 30) -> str:
    """
    Wait for Athena query to complete. Returns query status.
    """
    athena_client = boto3.client(
        'athena',
        region_name=REGION,
        aws_access_key_id=credentials['AccessKeyId'],
        aws_secret_access_key=credentials['SecretAccessKey'],
        aws_session_token=credentials['SessionToken']
    )
    
    for _ in range(max_wait):
        response = athena_client.get_query_execution(QueryExecutionId=query_execution_id)
        status = response['QueryExecution']['Status']['State']
        
        if status in ['SUCCEEDED', 'FAILED', 'CANCELLED']:
            return status
        
        time.sleep(1)
    
    return 'TIMEOUT'


def get_query_results(query_execution_id: str, credentials: Dict[str, str]) -> list:
    """
    Get Athena query results.
    """
    athena_client = boto3.client(
        'athena',
        region_name=REGION,
        aws_access_key_id=credentials['AccessKeyId'],
        aws_secret_access_key=credentials['SecretAccessKey'],
        aws_session_token=credentials['SessionToken']
    )
    
    response = athena_client.get_query_results(QueryExecutionId=query_execution_id)
    
    # Format results as list of dictionaries
    rows = response['ResultSet']['Rows']
    if not rows:
        return []
    
    # Extract column names from first row
    headers = [col['VarCharValue'] for col in rows[0]['Data']]
    
    # Extract data rows
    results = []
    for row in rows[1:]:  # Skip header row
        row_data = {}
        for i, col in enumerate(row.get('Data', [])):
            row_data[headers[i]] = col.get('VarCharValue', '')
        results.append(row_data)
    
    return results


def get_query_error(query_execution_id: str, credentials: Dict[str, str]) -> str:
    """
    Get detailed error information for failed query.
    """
    try:
        athena_client = boto3.client(
            'athena',
            region_name=REGION,
            aws_access_key_id=credentials['AccessKeyId'],
            aws_secret_access_key=credentials['SecretAccessKey'],
            aws_session_token=credentials['SessionToken']
        )
        
        response = athena_client.get_query_execution(QueryExecutionId=query_execution_id)
        state_change_reason = response['QueryExecution']['Status'].get('StateChangeReason', 'Unknown error')
        return state_change_reason
        
    except Exception as e:
        return f"Could not retrieve error details: {str(e)}"


def error_response(status_code: int, message: str) -> Dict[str, Any]:
    """
    Generate error response.
    """
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
