# API Key Authentication Solution - Index

## 📚 Documentation Navigation

### Quick Start
- **[Quick Reference](APIKEY_QUICKREF.md)** - Commands and common tasks
- **[Visual Guide](APIKEY_VISUAL_GUIDE.md)** - Diagrams and architecture flows

### Comprehensive Guides
- **[Complete README](APIKEY_SOLUTION_README.md)** - Full documentation with deployment, testing, and troubleshooting
- **[Solution Summary](APIKEY_SOLUTION_SUMMARY.md)** - Overview of all components and features

## 🚀 Get Started in 3 Steps

### 1. Deploy
```bash
./deploy-apikey-solution.sh dev deploymen-bkt us-east-1
```

### 2. Test
```bash
./test-apikey-solution.sh dev us-east-1
```

### 3. Use
```bash
curl -X POST "https://YOUR-API.execute-api.us-east-1.amazonaws.com/dev/query" \
  -H "x-api-key: YOUR-API-KEY" \
  -H "Content-Type: application/json" \
  -d '{"tableName": "members", "limit": 10}'
```

## 📂 Files Created

### Lambda Code (TypeScript)
```
lambdas-ts-apikey/
├── src/
│   ├── index.ts              # Main handler
│   ├── config.ts             # Configuration
│   ├── types.ts              # Type definitions
│   ├── services/
│   │   ├── apiKeyService.ts  # DynamoDB lookup
│   │   ├── roleService.ts    # STS AssumeRole
│   │   └── athenaService.ts  # Athena queries
│   └── utils/
│       ├── errorHandler.ts   # Error handling
│       └── logger.ts         # Structured logging
├── package.json
├── tsconfig.json
└── build.sh
```

### CloudFormation Templates
- **lambda-apikey-stack.yaml** - Lambda function and execution role
- **api-apikey-stack.yaml** - API Gateway with /query endpoint

### Deployment & Testing
- **deploy-apikey-solution.sh** - Automated deployment script
- **test-apikey-solution.sh** - Automated test suite

### Documentation
- **APIKEY_SOLUTION_README.md** - Complete guide (100+ lines)
- **APIKEY_QUICKREF.md** - Command cheat sheet
- **APIKEY_SOLUTION_SUMMARY.md** - Component overview
- **APIKEY_VISUAL_GUIDE.md** - Architecture diagrams
- **APIKEY_INDEX.md** - This file

## 🎯 Use Cases

| Use Case | Solution |
|----------|----------|
| **Production API** | Deploy standalone with production parameters |
| **Development Testing** | Use demo API key from deployment script |
| **Integration** | Add to main.yaml as nested stacks |
| **Microservice** | Isolated service for LF queries |
| **Template** | Copy and customize for other services |

## 🔗 Quick Links

### Deployment
- [Standalone Deployment](APIKEY_SOLUTION_README.md#standalone-deployment)
- [Integration with Master Template](APIKEY_SOLUTION_README.md#integration-with-master-template)

### Development
- [Build Lambda Code](APIKEY_QUICKREF.md#build-lambda)
- [Update Lambda](APIKEY_SOLUTION_SUMMARY.md#update-lambda-code)
- [Local Testing](APIKEY_QUICKREF.md#testing)

### Operations
- [Monitoring](APIKEY_QUICKREF.md#monitoring)
- [Troubleshooting](APIKEY_SOLUTION_README.md#troubleshooting)
- [Cleanup](APIKEY_QUICKREF.md#cleanup)

### Architecture
- [Request Flow](APIKEY_VISUAL_GUIDE.md#request-flow)
- [Stack Dependencies](APIKEY_VISUAL_GUIDE.md#stack-dependencies)
- [IAM Permissions](APIKEY_VISUAL_GUIDE.md#iam-permissions-flow)

## ✨ Key Features

✅ **Isolated** - Separate from multi-auth Lambda  
✅ **TypeScript** - Type-safe code with modern SDK v3  
✅ **Modular** - Clean service layer architecture  
✅ **Documented** - Comprehensive guides and diagrams  
✅ **Tested** - Automated test suite included  
✅ **Pluggable** - Easy to integrate or deploy standalone  
✅ **Production-Ready** - Error handling, logging, monitoring  

## 🛠️ Technology Stack

- **Language:** TypeScript (Node.js 20.x)
- **Infrastructure:** AWS CloudFormation
- **AWS Services:** Lambda, API Gateway, DynamoDB, STS, Athena, Lake Formation
- **Dependencies:** AWS SDK v3 (client-athena, client-dynamodb, client-sts, lib-dynamodb)

## 📊 Comparison with Multi-Auth Lambda

| Aspect | Multi-Auth Lambda | API Key Lambda |
|--------|------------------|----------------|
| **Auth Methods** | API Key, IAM, OAuth | API Key only |
| **LOC** | ~500 lines | ~250 lines |
| **Dependencies** | 5 AWS SDKs + Cognito | 3 AWS SDKs |
| **Complexity** | High | Low |
| **Deployment** | Coupled with OAuth | Independent |
| **Testing** | Complex (3 auth paths) | Simple (1 auth path) |
| **Use Case** | Flexible multi-auth | Focused API key |

## 🎓 Learning Path

1. **Start:** Read [Solution Summary](APIKEY_SOLUTION_SUMMARY.md)
2. **Understand:** Review [Visual Guide](APIKEY_VISUAL_GUIDE.md)
3. **Deploy:** Run [deployment script](deploy-apikey-solution.sh)
4. **Test:** Execute [test script](test-apikey-solution.sh)
5. **Customize:** Modify Lambda code in `lambdas-ts-apikey/src/`
6. **Reference:** Use [Quick Reference](APIKEY_QUICKREF.md) for commands

## 🔒 Security Notes

- API keys validated by API Gateway before Lambda invocation
- Lambda assumes least-privilege IAM roles from DynamoDB mapping
- Lake Formation enforces tag-based access control on all queries
- All requests logged to CloudWatch for audit trail
- HTTPS enforced by API Gateway (TLS 1.2+)
- Rate limiting configured via Usage Plan

## 💡 Tips

- **Development:** Use `LOG_LEVEL=DEBUG` for detailed logs
- **Production:** Configure CloudWatch alarms for error rates
- **Testing:** Use demo API key for initial validation
- **Monitoring:** Enable API Gateway execution logs
- **Performance:** Adjust Lambda memory based on query complexity

## 📞 Support

For questions or issues:
1. Check [Troubleshooting Guide](APIKEY_SOLUTION_README.md#troubleshooting)
2. Review CloudWatch logs: `/aws/lambda/lf-athena-apikey-handler-{env}`
3. Verify prerequisites in [deployment guide](APIKEY_SOLUTION_README.md#prerequisites)

## 🎉 You're Ready!

The complete API Key authentication solution is ready to deploy. Start with:

```bash
./deploy-apikey-solution.sh dev deploymen-bkt us-east-1
```

Happy deploying! 🚀
