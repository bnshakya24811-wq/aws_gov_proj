"""
Lambda handler for OAuth Client Credentials flow.
Validates Bearer token and maps client_id to Lake Formation role.
"""
import json
import boto3
import os
import time
import base64
from typing import Dict, Any, Optional
from botocore.exceptions import ClientError

# Environment variables
COGNITO_USER_POOL_ID = os.environ['COGNITO_USER_POOL_ID']
COGNITO_REGION = os.environ.get('COGNITO_REGION', os.environ['REGION'])
DATABASE_NAME = os.environ['DATABASE_NAME']
ATHENA_OUTPUT_BUCKET = os.environ['ATHENA_OUTPUT_BUCKET']
REGION = os.environ['REGION']
LF_DEV_ROLE_ARN = os.environ['LF_DEV_ROLE_ARN']
LF_SUPER_ROLE_ARN = os.environ['LF_SUPER_ROLE_ARN']

# AWS clients
sts_client = boto3.client('sts', region_name=REGION)
athena_client = boto3.client('athena', region_name=REGION)

# Client ID to Role Mapping
# This maps specific client IDs to their Lake Formation roles
CLIENT_ROLE_MAPPING = {
    # ETL clients get write access (super role)
    'etl-service': LF_SUPER_ROLE_ARN,
    
    # Reporting and monitoring get read-only (dev role)
    'reporting-service': LF_DEV_ROLE_ARN,
    'monitoring-service': LF_DEV_ROLE_ARN,
}

# Scope to Role Mapping (fallback if client_id not in mapping)
SCOPE_ROLE_MAPPING = {
    'athena-api/query.admin': LF_SUPER_ROLE_ARN,
    'athena-api/query.write': LF_SUPER_ROLE_ARN,
    'athena-api/query.read': LF_DEV_ROLE_ARN,
}


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    OAuth Client Credentials handler.
    
    Expected request:
    Headers: Authorization: Bearer <access_token>
    Body: { "query": "SELECT * FROM table" }
    """
    try:
        # Extract Bearer token from Authorization header
        auth_header = event.get('headers', {}).get('Authorization', '')
        
        if not auth_header.startswith('Bearer '):
            return error_response(401, "Missing or invalid Authorization header. Expected: Bearer <token>")
        
        access_token = auth_header.replace('Bearer ', '').strip()
        
        if not access_token:
            return error_response(401, "Missing access token")
        
        # Parse request body
        try:
            body = json.loads(event.get('body', '{}'))
        except json.JSONDecodeError:
            return error_response(400, "Invalid JSON in request body")
        
        query = body.get('query')
        if not query:
            return error_response(400, "Missing required parameter: query")
        
        # Step 1: Decode and validate JWT token
        token_info = decode_jwt_token(access_token)
        
        if not token_info:
            return error_response(401, "Invalid or expired token")
        
        # Step 2: Extract client_id and scopes from token
        client_id = token_info.get('client_id')
        scopes = token_info.get('scope', '').split()
        token_use = token_info.get('token_use')
        
        # Validate token type
        if token_use != 'access':
            return error_response(401, "Invalid token type. Expected access token")
        
        print(f"✅ Token validated - Client: {client_id}, Scopes: {scopes}")
        
        # Step 3: Map client to Lake Formation role
        lf_role_arn = map_client_to_lf_role(client_id, scopes)
        
        if not lf_role_arn:
            return error_response(403, f"Client '{client_id}' not authorized")
        
        print(f"🔑 Mapped client '{client_id}' to role: {lf_role_arn}")
        
        # Step 4: Assume Lake Formation role
        assumed_credentials = assume_role(lf_role_arn, client_id)
        
        if not assumed_credentials:
            return error_response(500, "Failed to assume Lake Formation role")
        
        # Step 5: Execute Athena query
        query_execution_id = start_athena_query(query, assumed_credentials)
        
        if not query_execution_id:
            return error_response(500, "Failed to start Athena query")
        
        # Step 6: Wait for query completion
        status = wait_for_query_completion(query_execution_id, assumed_credentials)
        
        if status != 'SUCCEEDED':
            return error_response(500, f"Query failed with status: {status}")
        
        # Step 7: Get query results
        results = get_query_results(query_execution_id, assumed_credentials)
        
        print(f"✅ Query completed successfully - Rows: {len(results) - 1}")
        
        return success_response({
            'success': True,
            'authMethod': 'CLIENT_CREDENTIALS',
            'clientId': client_id,
            'scopes': scopes,
            'lfRole': lf_role_arn,
            'queryExecutionId': query_execution_id,
            'query': query,
            'rowCount': len(results) - 1,
            'data': results
        })
        
    except Exception as e:
        print(f"❌ Unexpected error: {str(e)}")
        import traceback
        traceback.print_exc()
        return error_response(500, f"Internal server error: {str(e)}")


def decode_jwt_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Decode JWT token (without signature verification for now).
    In production, you should verify the signature using Cognito's public keys.
    """
    try:
        # JWT has 3 parts: header.payload.signature
        parts = token.split('.')
        
        if len(parts) != 3:
            print("❌ Invalid JWT format")
            return None
        
        # Decode payload (second part)
        payload = parts[1]
        
        # Add padding if needed (JWT base64 may not be padded)
        padding = 4 - (len(payload) % 4)
        if padding != 4:
            payload += '=' * padding
        
        decoded = base64.urlsafe_b64decode(payload)
        token_data = json.loads(decoded)
        
        # Check expiration
        exp = token_data.get('exp', 0)
        if time.time() > exp:
            print("❌ Token expired")
            return None
        
        # Validate issuer (Cognito User Pool)
        expected_issuer = f"https://cognito-idp.{COGNITO_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}"
        if token_data.get('iss') != expected_issuer:
            print(f"❌ Invalid issuer: {token_data.get('iss')}")
            return None
        
        return token_data
        
    except Exception as e:
        print(f"❌ Token decode error: {str(e)}")
        return None


def map_client_to_lf_role(client_id: str, scopes: list) -> Optional[str]:
    """
    Map client_id or scopes to Lake Formation role ARN.
    
    Priority:
    1. Check CLIENT_ROLE_MAPPING for explicit client_id mapping
    2. Check SCOPE_ROLE_MAPPING based on granted scopes
    """
    # Extract client name from client_id (format: "5abc123def" or "etl-service-client")
    # Try to match against our known client prefixes
    for client_prefix, role_arn in CLIENT_ROLE_MAPPING.items():
        if client_prefix in client_id.lower():
            print(f"🔑 Matched client prefix '{client_prefix}' → {role_arn}")
            return role_arn
    
    # Fallback: Map by scope
    # Use highest privilege scope found
    if 'athena-api/query.admin' in scopes or 'athena-api/query.write' in scopes:
        print(f"🔑 Scope-based mapping: write/admin scope → {LF_SUPER_ROLE_ARN}")
        return LF_SUPER_ROLE_ARN
    elif 'athena-api/query.read' in scopes:
        print(f"🔑 Scope-based mapping: read scope → {LF_DEV_ROLE_ARN}")
        return LF_DEV_ROLE_ARN
    
    # No matching mapping found
    print(f"❌ No role mapping for client '{client_id}' with scopes {scopes}")
    return None


def assume_role(role_arn: str, session_name: str) -> Optional[Dict[str, str]]:
    """
    Assume IAM role and return temporary credentials.
    """
    try:
        response = sts_client.assume_role(
            RoleArn=role_arn,
            RoleSessionName=f"client-{session_name[:32]}",  # Truncate to 32 chars
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
        athena = boto3.client(
            'athena',
            region_name=REGION,
            aws_access_key_id=credentials['AccessKeyId'],
            aws_secret_access_key=credentials['SecretAccessKey'],
            aws_session_token=credentials['SessionToken']
        )
        
        response = athena.start_query_execution(
            QueryString=query,
            QueryExecutionContext={'Database': DATABASE_NAME},
            ResultConfiguration={
                'OutputLocation': f'{ATHENA_OUTPUT_BUCKET}client-creds-queries/'
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
    athena = boto3.client(
        'athena',
        region_name=REGION,
        aws_access_key_id=credentials['AccessKeyId'],
        aws_secret_access_key=credentials['SecretAccessKey'],
        aws_session_token=credentials['SessionToken']
    )
    
    for i in range(max_wait):
        try:
            response = athena.get_query_execution(QueryExecutionId=query_execution_id)
            status = response['QueryExecution']['Status']['State']
            
            if status in ['SUCCEEDED', 'FAILED', 'CANCELLED']:
                return status
            
            time.sleep(1)
            
        except ClientError as e:
            print(f"❌ Error checking query status: {e.response['Error']['Message']}")
            return 'FAILED'
    
    return 'TIMEOUT'


def get_query_results(query_execution_id: str, credentials: Dict[str, str]) -> list:
    """
    Get Athena query results.
    """
    try:
        athena = boto3.client(
            'athena',
            region_name=REGION,
            aws_access_key_id=credentials['AccessKeyId'],
            aws_secret_access_key=credentials['SecretAccessKey'],
            aws_session_token=credentials['SessionToken']
        )
        
        response = athena.get_query_results(QueryExecutionId=query_execution_id)
        
        # Convert to array format
        results = []
        for row in response['ResultSet']['Rows']:
            results.append([col.get('VarCharValue', '') for col in row['Data']])
        
        return results
        
    except ClientError as e:
        print(f"❌ Failed to get query results: {e.response['Error']['Message']}")
        return []


def success_response(data: Dict[str, Any]) -> Dict[str, Any]:
    """Create success response."""
    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        'body': json.dumps(data, default=str)
    }


def error_response(status_code: int, message: str) -> Dict[str, Any]:
    """Create error response."""
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
