#!/usr/bin/env python3
"""
Helper script to create API keys for Lake Formation API Key POC

This script:
1. Generates a secure random API key (or uses provided key)
2. Stores the API key in AWS Secrets Manager
3. Creates a mapping in DynamoDB (secretId -> roleArn)

Usage:
    python create-api-key.py --user-name dev-user --role-arn arn:aws:iam::123:role/dev-role --region us-east-1 --environment dev
    python create-api-key.py --user-name super-user --role-arn arn:aws:iam::123:role/super-role --api-key custom-key-123 --region us-east-1 --environment dev
"""

import argparse
import boto3
import json
import secrets
import string
from typing import Optional


def generate_api_key(length: int = 32) -> str:
    """Generate a secure random API key"""
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))


def create_secret(
    secrets_client: boto3.client,
    secret_name: str,
    api_key: str,
    user_name: str,
    permissions: str,
    environment: str
) -> str:
    """Create or update a secret in Secrets Manager"""
    
    secret_value = {
        "apiKey": api_key,
        "userName": user_name,
        "permissions": permissions
    }
    
    try:
        # Try to create the secret
        response = secrets_client.create_secret(
            Name=secret_name,
            Description=f"API Key for {user_name} in {environment} environment",
            SecretString=json.dumps(secret_value),
            Tags=[
                {'Key': 'Environment', 'Value': environment},
                {'Key': 'Project', 'Value': 'LakeFormationAccessControl'},
                {'Key': 'UserRole', 'Value': user_name}
            ]
        )
        print(f"✓ Created secret: {secret_name}")
        return response['ARN']
    except secrets_client.exceptions.ResourceExistsException:
        # Secret already exists, update it
        response = secrets_client.update_secret(
            SecretId=secret_name,
            SecretString=json.dumps(secret_value)
        )
        print(f"✓ Updated existing secret: {secret_name}")
        return response['ARN']


def create_dynamodb_mapping(
    dynamodb_client: boto3.client,
    table_name: str,
    secret_arn: str,
    role_arn: str,
    user_name: str,
    permissions: str
) -> None:
    """Create mapping in DynamoDB"""
    
    dynamodb_client.put_item(
        TableName=table_name,
        Item={
            'secretId': {'S': secret_arn},
            'roleArn': {'S': role_arn},
            'userName': {'S': user_name},
            'permissions': {'S': permissions}
        }
    )
    print(f"✓ Created DynamoDB mapping: {secret_arn} -> {role_arn}")


def main():
    parser = argparse.ArgumentParser(
        description='Create API key for Lake Formation access control'
    )
    parser.add_argument(
        '--user-name',
        required=True,
        help='User name (e.g., dev-user, super-user, analyst-user)'
    )
    parser.add_argument(
        '--role-arn',
        required=True,
        help='ARN of the IAM role to assume when this API key is used'
    )
    parser.add_argument(
        '--permissions',
        default='read-only',
        help='Permission level (e.g., read-only, full-access)'
    )
    parser.add_argument(
        '--api-key',
        help='Custom API key (if not provided, a random key will be generated)'
    )
    parser.add_argument(
        '--environment',
        default='dev',
        help='Environment (dev, staging, prod)'
    )
    parser.add_argument(
        '--region',
        default='us-east-1',
        help='AWS region'
    )
    parser.add_argument(
        '--table-name',
        help='DynamoDB table name (default: lf-apikey-mappings-apk-{environment})'
    )
    
    args = parser.parse_args()
    
    # Initialize AWS clients
    secrets_client = boto3.client('secretsmanager', region_name=args.region)
    dynamodb_client = boto3.client('dynamodb', region_name=args.region)
    
    # Generate or use provided API key
    api_key = args.api_key if args.api_key else generate_api_key()
    
    # Construct resource names
    secret_name = f"lf-apikey-{args.user_name}-apk-{args.environment}"
    table_name = args.table_name if args.table_name else f"lf-apikey-mappings-apk-{args.environment}"
    
    print(f"\n{'='*60}")
    print(f"Creating API Key Configuration")
    print(f"{'='*60}")
    print(f"User Name:      {args.user_name}")
    print(f"Role ARN:       {args.role_arn}")
    print(f"Permissions:    {args.permissions}")
    print(f"Environment:    {args.environment}")
    print(f"Region:         {args.region}")
    print(f"Secret Name:    {secret_name}")
    print(f"DynamoDB Table: {table_name}")
    print(f"{'='*60}\n")
    
    # Step 1: Create secret in Secrets Manager
    print("Step 1: Creating secret in Secrets Manager...")
    secret_arn = create_secret(
        secrets_client,
        secret_name,
        api_key,
        args.user_name,
        args.permissions,
        args.environment
    )
    
    # Step 2: Create mapping in DynamoDB
    print("\nStep 2: Creating mapping in DynamoDB...")
    create_dynamodb_mapping(
        dynamodb_client,
        table_name,
        secret_arn,
        args.role_arn,
        args.user_name,
        args.permissions
    )
    
    # Display results
    print(f"\n{'='*60}")
    print(f"✓ API Key Configuration Created Successfully!")
    print(f"{'='*60}")
    print(f"\nAPI Key: {api_key}")
    print(f"\nTo use this API key, include it in the x-api-key header:")
    print(f"  curl -H 'x-api-key: {api_key}' https://your-api-endpoint/query")
    print(f"\n{'='*60}\n")


if __name__ == '__main__':
    main()
