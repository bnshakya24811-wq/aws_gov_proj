#!/usr/bin/env python3
"""
Test IAM authentication for API Gateway endpoint.
Uses SigV4 signing with AWS credentials.
"""
import boto3
import json
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

# IAM User credentials (lf-lh-dev-user-o-sp5-dev)
ACCESS_KEY = "YOUR_AWS_ACCESS_KEY_ID"  # Replace with your actual access key
SECRET_KEY = "YOUR_AWS_SECRET_ACCESS_KEY"  # Replace with your actual secret key

# API endpoint (IAM authenticated)
URL = "https://s61dm9xt8i.execute-api.ap-southeast-2.amazonaws.com/dev/query-iam"

# Request body
body = json.dumps({
    "tableName": "lf_lh_silver_bkt_o_sp5_dev",
    "limit": 5
})

# Create a session with the IAM user credentials
session = boto3.Session(
    aws_access_key_id=ACCESS_KEY,
    aws_secret_access_key=SECRET_KEY,
    region_name='ap-southeast-2'
)

# Create an AWS request
request = AWSRequest(method='POST', url=URL, data=body, headers={
    'Content-Type': 'application/json'
})

# Sign the request with SigV4
SigV4Auth(session.get_credentials(), "execute-api", "ap-southeast-2").add_auth(request)

# Send the request
import urllib.request
req = urllib.request.Request(
    URL,
    data=body.encode('utf-8'),
    headers=dict(request.headers)
)

try:
    with urllib.request.urlopen(req) as response:
        result = json.loads(response.read().decode('utf-8'))
        print(json.dumps(result, indent=2))
except urllib.error.HTTPError as e:
    print(f"Error {e.code}: {e.read().decode('utf-8')}")
