# Serverless Framework Implementation - Deployment Files

## ✅ Essential Deployment Files Created

### **Core Configuration**
- `serverless.yml` - Main Serverless Framework configuration (v3.39.0)
- `package.json` - Node.js dependencies and scripts
- `tsconfig.json` - TypeScript configuration
- `.gitignore` - Git ignore patterns

### **CloudFormation Resource Stacks**
1. `resources/iam-stack.yml` - IAM roles (Lambda execution + LF user roles)
2. `resources/dynamodb-stack.yml` - API key mapping table
3. `resources/api-gateway-stack.yml` - API Gateway keys + Secrets Manager
4. `resources/governance-stack.yml` - Lake Formation TBAC permissions

### **Lambda Source Code** (Copied from working POC)
- `src/index.ts` - Main Lambda handler
- `src/config.ts` - Configuration management
- `src/types.ts` - TypeScript type definitions
- `src/services/` - Business logic services
  - `apiKeyAuthService.ts` - API key authentication
  - `athenaService.ts` - Athena query execution
  - `roleService.ts` - IAM role assumption
  - `secretsManagerService.ts` - Secrets retrieval
  - And more...
- `src/utils/` - Utility functions
  - `logger.ts` - Logging utilities
  - `errorHandler.ts` - Error handling

## 🎯 Key Features

- **Serverless Framework v3** (latest before v4)
- **TypeScript** with Node.js 20.x runtime
- **Modular CloudFormation** resources
- **Same architecture** as working POC
- **Lake Formation TBAC** support
- **API Gateway API Keys** authentication
- **Secrets Manager** integration
- **DynamoDB** for API key mappings

## 📦 Deployment Commands

```bash
# Install dependencies
npm install

# Deploy to dev
npm run deploy:dev

# View logs
npm run logs

# Remove stack
serverless remove --stage dev
```

## 🔑 Configuration Parameters

Located in `serverless.yml` under `params.dev`:
- `DatabaseName`: lf-lh-silver-db-o-sp5-dev
- `AthenaBucketName`: aws-athena-query-results-480399101976-ap-southeast-2
- `AthenaOutputPrefix`: api-key-poc/
- `LambdaArtifactsBucket`: lf-apikey-lambda-artifacts-dev-480399101976

## 📁 Project Structure

```
lf-api-key-sv-poc/
├── serverless.yml          # Main config
├── package.json            # Dependencies
├── tsconfig.json          # TypeScript config
├── README.md              # Documentation
├── resources/             # CloudFormation stacks
│   ├── iam-stack.yml
│   ├── dynamodb-stack.yml
│   ├── api-gateway-stack.yml
│   └── governance-stack.yml
└── src/                   # Lambda source code
    ├── index.ts           # Handler
    ├── config.ts
    ├── types.ts
    ├── services/          # Business logic
    └── utils/             # Utilities
```

## ✅ Ready for Deployment

All essential templates and source code have been copied from the working POC deployment. The Serverless Framework v3 configuration maintains the same architecture while providing a serverless-native deployment experience.
