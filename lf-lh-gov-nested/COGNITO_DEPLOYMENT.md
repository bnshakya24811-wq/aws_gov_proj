# Cognito Deployment Guide

The Cognito stack is deployed **separately** from the main stack to handle the OAuth setup correctly.

## Deployment Order

### Step 1: Deploy Cognito Stack (One-time Setup)

```bash
cd /home/bipinns/repos/github/lakehouse_access_control_poc/lf-lh-gov-nested

# Deploy Cognito stack
aws cloudformation create-stack \
  --stack-name lf-lh-cognito-stack-o-sp6-dev \
  --template-body file://cognito-stack.yaml \
  --parameters ParameterKey=Environment,ParameterValue=dev \
  --region ap-southeast-2

# Wait for completion
aws cloudformation wait stack-create-complete \
  --stack-name lf-lh-cognito-stack-o-sp6-dev \
  --region ap-southeast-2
```

### Step 2: Populate Client Secret in Secrets Manager

```bash
# Run the script to retrieve and store the Cognito client secret
./update-cognito-secret.sh dev ap-southeast-2
```

This script:
- Retrieves the User Pool ID and App Client ID from CloudFormation
- Calls Cognito API to get the App Client Secret
- Updates Secrets Manager with the actual secret

### Step 3: Get Cognito Outputs for Main Stack

```bash
# Get User Pool ID
USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name lf-lh-cognito-stack-o-sp6-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
  --output text \
  --region ap-southeast-2)

# Get App Client ID
APP_CLIENT_ID=$(aws cloudformation describe-stacks \
  --stack-name lf-lh-cognito-stack-o-sp6-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`AppClientId`].OutputValue' \
  --output text \
  --region ap-southeast-2)

echo "User Pool ID: ${USER_POOL_ID}"
echo "App Client ID: ${APP_CLIENT_ID}"
```

### Step 4: Deploy Main Stack with OAuth Enabled

```bash
# Upload templates to S3
./upload-templates.sh

# Deploy/Update main stack with Cognito parameters
aws cloudformation update-stack \
  --stack-name lf-lh-main-stack-o-sp6-dev \
  --template-body file://main.yaml \
  --parameters \
    ParameterKey=Environment,ParameterValue=dev \
    ParameterKey=EnableOAuth,ParameterValue=true \
    ParameterKey=CognitoUserPoolId,ParameterValue=${USER_POOL_ID} \
    ParameterKey=CognitoAppClientId,ParameterValue=${APP_CLIENT_ID} \
    ParameterKey=TemplateS3Bucket,UsePreviousValue=true \
    ParameterKey=LambdaCodeS3Bucket,UsePreviousValue=true \
  --capabilities CAPABILITY_NAMED_IAM \
  --region ap-southeast-2
```

## Testing OAuth Authentication

### Create a Test User

```bash
# Create user
aws cognito-idp admin-create-user \
  --user-pool-id ${USER_POOL_ID} \
  --username testuser@example.com \
  --user-attributes Name=email,Value=testuser@example.com \
  --temporary-password "TempPass123!" \
  --region ap-southeast-2

# Add user to Developers group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id ${USER_POOL_ID} \
  --username testuser@example.com \
  --group-name Developers \
  --region ap-southeast-2
```

### Test Authentication via API

```bash
# Get API endpoint from main stack outputs
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name lf-lh-main-stack-o-sp6-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`APIEndpointOAuth`].OutputValue' \
  --output text \
  --region ap-southeast-2)

# Test OAuth authentication
curl -X POST "${API_ENDPOINT}" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser@example.com",
    "password": "TempPass123!",
    "tableName": "your_table_name",
    "limit": 10
  }'
```

## User Groups to Lake Formation Role Mapping

| Cognito Group | Lake Formation Role | Permissions |
|--------------|-------------------|-------------|
| Developers | LF Dev User | Limited access (non-PII data) |
| Analysts | LF Dev User | Limited access (non-PII data) |
| DataScientists | LF Dev User | Limited access (non-PII data) |
| Admins | LF Super User | Full access (all data including PII) |

## Troubleshooting

### Secret Not Found Error

If Lambda fails with "Secrets Manager can't find the specified secret":
```bash
# Verify secret exists
aws secretsmanager describe-secret \
  --secret-id lf-cognito-client-secret-dev \
  --region ap-southeast-2

# If not found, run Step 2 again
./update-cognito-secret.sh dev ap-southeast-2
```

### Invalid Client Secret

If authentication fails with invalid client secret:
```bash
# Re-run the secret update script
./update-cognito-secret.sh dev ap-southeast-2

# Then redeploy Lambda stack
aws cloudformation update-stack \
  --stack-name lf-lh-lambda-stack-o-sp6-dev \
  --use-previous-template \
  --parameters <...previous parameters...> \
  --capabilities CAPABILITY_NAMED_IAM
```

## Cleanup

To remove Cognito stack:
```bash
# Delete Cognito stack
aws cloudformation delete-stack \
  --stack-name lf-lh-cognito-stack-o-sp6-dev \
  --region ap-southeast-2

# Delete secret manually (not deleted by stack)
aws secretsmanager delete-secret \
  --secret-id lf-cognito-client-secret-dev \
  --force-delete-without-recovery \
  --region ap-southeast-2
```
