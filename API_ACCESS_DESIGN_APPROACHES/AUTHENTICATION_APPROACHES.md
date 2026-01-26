# API Authentication Approaches - Comparison & Design Guide

## Overview

This document compares three authentication approaches implemented/discussed for the Lake Formation API Gateway solution. Each approach balances simplicity, security, and auditability differently.

---

## Implemented Approaches

### 1. API Key Authentication

**Implementation Status:** ✅ Fully implemented

**How it works:**
1. Client obtains API key (static string)
2. Client includes key in request header: `x-api-key: <key>`
3. API Gateway validates key existence
4. Lambda looks up API key in DynamoDB to find Lake Formation role ARN
5. Lambda assumes LF role and executes query

**Endpoint:** `POST /query`

**DynamoDB Mapping:**
```
apiKey: "EXAMPLE_API_KEY_REPLACE_WITH_ACTUAL_KEY"
roleArn: "arn:aws:iam::123456789012:role/lf-lh-super-user-role"
description: "Super User - Full Access"
```

---

### 2. Direct IAM Authentication

**Implementation Status:** ✅ Fully implemented

**How it works:**
1. Client has IAM credentials (Access Key ID + Secret Access Key)
2. Client uses AWS SDK to sign request with AWS Signature V4
3. API Gateway validates IAM signature and extracts user identity
4. Lambda receives IAM user ARN from request context
5. Lambda maps IAM user ARN to Lake Formation role ARN (hardcoded mapping)
6. Lambda assumes LF role and executes query

**Endpoint:** `POST /query-iam` (AWS_IAM authorization)

**Identity Mapping (in code):**
```typescript
const IAM_USER_TO_ROLE_MAPPING = {
  'arn:aws:iam::123456789012:user/lf-lh-dev-user': 'arn:aws:iam::123456789012:role/lf-lh-dev-user-role',
  'arn:aws:iam::123456789012:user/lf-lh-super-user': 'arn:aws:iam::123456789012:role/lf-lh-super-user-role',
  // SSO assumed role patterns
  'arn:aws:sts::*:assumed-role/DeveloperAccess/*': 'arn:aws:iam::123456789012:role/lf-lh-dev-user-role'
};
```

---

### 3. SSO with IAM (Federated Identity)

**Implementation Status:** 📋 Designed but not implemented

**How it works:**
1. User authenticates with Identity Provider (Okta, Azure AD, etc.)
2. IdP sends SAML assertion to AWS IAM Identity Center
3. AWS STS creates temporary credentials (valid 1-12 hours)
4. Client uses temporary credentials to sign API request (same as Direct IAM)
5. Lambda receives assumed-role ARN from request context
6. Lambda maps assumed-role ARN to Lake Formation role ARN
7. Lambda assumes LF role and executes query

**Endpoint:** `POST /query-iam` (same as Direct IAM)

**Identity Mapping (pattern-based):**
```typescript
const SSO_ROLE_PATTERNS = {
  'arn:aws:sts::*:assumed-role/DeveloperAccess/*': 'lf-dev-role',
  'arn:aws:sts::*:assumed-role/DataScientistAccess/*': 'lf-dev-role',
  'arn:aws:sts::*:assumed-role/AdminAccess/*': 'lf-super-user-role'
};
```

---

## Comparison Matrix

| Feature | API Key | Direct IAM | SSO with IAM |
|---------|---------|------------|--------------|
| **Client Complexity** | ⭐⭐⭐ Very Simple | ⭐⭐ Moderate | ⭐⭐ Moderate (after initial login) |
| **Requires AWS SDK** | ❌ No | ✅ Yes | ✅ Yes |
| **Individual User Identity** | ❌ No | ✅ Yes | ✅ Yes |
| **Credential Lifetime** | ♾️ Permanent (until rotated) | ♾️ Permanent | ⏰ Temporary (1-12 hours) |
| **Credential Rotation** | 🔄 Manual via API Gateway console | 🔄 Manual (create new keys) | ✅ Automatic (on session expiry) |
| **CloudTrail Audit Trail** | ⚠️ API key ID (not user name) | ✅ Full IAM user ARN | ✅ Full SSO user email + role |
| **Revocation Speed** | ⚡ Immediate (delete key) | ⚡ Immediate (delete user/keys) | ⚡ Immediate (revoke IdP access) |
| **Multi-Factor Auth (MFA)** | ❌ Not supported | ⚠️ Optional (enforced via IAM policy) | ✅ Enforced by IdP |
| **Centralized User Management** | ❌ AWS API Gateway only | ⚠️ AWS IAM only | ✅ Corporate IdP (Okta/Azure AD) |
| **Per-User Permissions** | ❌ No (shared keys) | ✅ Yes | ✅ Yes |
| **Suitable for External Partners** | ✅ Yes (simple integration) | ⚠️ Requires AWS account access | ❌ No (requires corporate SSO) |
| **Suitable for Background Jobs** | ✅ Excellent (no expiry) | ✅ Good (service account) | ❌ Poor (credentials expire) |
| **Suitable for Internal Users** | ⚠️ Poor (no individual identity) | ✅ Good | ⭐ Excellent (SSO experience) |
| **Cost** | 💰 API Gateway API keys (free tier) | 💰 Free (IAM users) | 💰💰 IAM Identity Center + IdP license |
| **Security Posture** | ⚠️ Medium (shared secrets) | ✅ Good (individual credentials) | ⭐ Excellent (temp creds + MFA) |
| **Secret Management Need** | 📦 Low (single string) | 📦📦 High (Access Key + Secret) | 📦 Low (auto-managed) |

---

## Detailed Pros & Cons

### API Key Authentication

#### ✅ Pros
- **Simplest client implementation** - Just HTTP header, no AWS SDK required
- **No AWS account needed** - External partners can integrate easily
- **Works everywhere** - curl, Postman, any HTTP library
- **Best for background jobs** - No credential expiry, no complex secret management
- **Quick to set up** - Generate key in API Gateway console
- **Language agnostic** - No AWS SDK dependency

#### ❌ Cons
- **No individual user tracking** - Can't determine who made each request
- **Shared credentials** - Multiple people use same key (defeats individual permissions)
- **Poor audit trail** - CloudTrail shows API key ID, not actual user
- **Manual rotation** - No automatic expiry or renewal
- **Limited governance** - Can't enforce MFA or conditional access
- **Scalability issues** - Need to create/manage many keys for per-job granularity

#### 🎯 Best Use Cases
- External partner integrations
- Background scheduled jobs (ETL, data pipelines)
- Simple proof-of-concept implementations
- Systems without AWS SDK support
- When individual user identity is not required
- Third-party SaaS integration webhooks

---

### Direct IAM Authentication

#### ✅ Pros
- **Individual user identity** - Full CloudTrail audit with IAM user ARN
- **AWS-native security** - Leverages IAM policies, MFA, conditional access
- **Granular permissions** - Different IAM users can map to different LF roles
- **Service account support** - Dedicated IAM users for automated jobs
- **No API Gateway limits** - Not subject to API key quotas
- **Standard AWS pattern** - Familiar to AWS developers

#### ❌ Cons
- **Requires AWS SDK** - Client must implement SigV4 signing
- **Client complexity** - More code than simple API key
- **Credential management** - Must securely store Access Key + Secret Key
- **Long-lived credentials** - No automatic expiry (unless manually rotated)
- **AWS account required** - Can't give to external partners easily
- **Language dependency** - Need AWS SDK in client's language

#### 🎯 Best Use Cases
- Internal AWS-native applications (Lambda, ECS, EC2)
- Background jobs running on AWS infrastructure
- Teams already using AWS services
- When per-user audit trail is critical
- Enterprise environments with AWS account structure
- Automated systems needing persistent access

---

### SSO with IAM (Federated Identity)

#### ✅ Pros
- **Best user experience** - Single sign-on with corporate credentials
- **Strongest security** - Temporary credentials + enforced MFA
- **Centralized management** - Add/remove users in corporate IdP (Okta/Azure AD)
- **Automatic expiry** - Credentials expire (1-12 hours), reducing risk
- **No long-lived secrets** - No permanent Access Keys to leak
- **Per-user audit** - CloudTrail shows actual user email from SSO
- **Compliance friendly** - Meets enterprise security requirements
- **Role-based access** - Map SSO groups to AWS permissions

#### ❌ Cons
- **Complex initial setup** - Requires IdP configuration + AWS IAM Identity Center
- **Not suitable for background jobs** - Credentials expire (can't run unattended)
- **Requires corporate IdP** - Can't use with external partners
- **Session management** - Users must re-authenticate when credentials expire
- **Higher cost** - IAM Identity Center + IdP licensing fees
- **AWS SDK required** - Same client complexity as Direct IAM
- **Internal-only** - Only works for employees in corporate directory

#### 🎯 Best Use Cases
- Interactive human users (data analysts, scientists)
- Enterprise environments with existing SSO (Okta, Azure AD)
- Organizations requiring MFA enforcement
- Compliance-heavy industries (finance, healthcare)
- Large teams needing centralized user management
- When temporary credentials are desired security feature
- Postman/CLI tools used by employees

---

## Decision Framework

### When to Use API Keys
```
✅ Use if ANY of these are true:
- External partners need access
- Background jobs with no user context
- Simplest possible integration is priority
- Client doesn't support AWS SDK
- Individual user tracking is NOT required

❌ Avoid if ANY of these are true:
- Need per-user audit trail
- Compliance requires individual accountability
- Need to enforce MFA
- Want automatic credential rotation
```

### When to Use Direct IAM
```
✅ Use if ALL of these are true:
- Users/systems have AWS accounts
- Need individual user tracking
- Background jobs need persistent access
- AWS SDK integration is acceptable

❌ Avoid if ANY of these are true:
- External partners without AWS accounts
- Want SSO user experience
- Concerned about long-lived credentials
- Client can't use AWS SDK
```

### When to Use SSO with IAM
```
✅ Use if ALL of these are true:
- Internal employees only
- Organization has corporate IdP (Okta/Azure AD)
- Human interactive use (not background jobs)
- Security requires MFA + temporary credentials
- Want centralized user management

❌ Avoid if ANY of these are true:
- Need for external partners
- Background automated jobs
- Can't implement IdP integration
- Budget doesn't allow IdP licensing
```

---

## Hybrid Architecture (Recommended)

**Best practice:** Support multiple authentication methods simultaneously!

```
┌─────────────────────────────────────────────────┐
│           API Gateway (Single Lambda)           │
├─────────────────────────────────────────────────┤
│                                                 │
│  POST /query          → API Key Auth            │
│  POST /query-iam      → IAM Auth (Direct + SSO) │
│                                                 │
└─────────────────────────────────────────────────┘
                        ↓
            Lambda Auto-Detects Auth Method
                        ↓
        ┌───────────────┴───────────────┐
        ↓                               ↓
  API Key Lookup               IAM User/Role Mapping
  (DynamoDB)                   (Code or DynamoDB)
        ↓                               ↓
        └───────────────┬───────────────┘
                        ↓
              Map to LF Role ARN
                        ↓
              Assume LF Role + Execute Query
```

**Use case mapping:**
- **API Keys** → External partners, background ETL jobs
- **Direct IAM** → Service accounts for AWS-based automation
- **SSO with IAM** → Internal data analysts, scientists, engineers

---

## Bottom Line Recommendations

### 🥇 For External Partners
**Use: API Keys**
- Simplest integration, no AWS account needed
- Accept limitation of shared identity for external access

### 🥇 For Background Jobs (Outside AWS)
**Use: API Keys**
- No credential expiry issues
- Simple secret management (single string)

### 🥇 For Background Jobs (Inside AWS)
**Use: Direct IAM with Service Accounts**
- Leverage instance IAM roles (no keys to manage)
- Full audit trail of which job executed queries

### 🥇 For Internal Human Users
**Use: SSO with IAM**
- Best user experience with corporate SSO
- Strongest security with MFA + temporary credentials
- Centralized user management

### 🥇 For Proof-of-Concept / MVP
**Use: API Keys**
- Fastest to implement and test
- Can migrate to IAM/SSO later

### 🥇 For Enterprise Production
**Use: Hybrid (All Three)**
- API Keys for partners
- Direct IAM for service accounts
- SSO for employees
- Maximum flexibility with consistent backend

---

## Migration Path

```
Phase 1: Start Simple
├─ API Keys for initial testing
└─ Validate LF permissions work correctly

Phase 2: Add IAM
├─ Implement Direct IAM for AWS-based services
└─ Create service account IAM users for jobs

Phase 3: Add SSO (If Needed)
├─ Configure AWS IAM Identity Center
├─ Integrate with corporate IdP (Okta/Azure AD)
└─ Migrate human users from API keys to SSO

Phase 4: Governance
├─ Monitor usage patterns (CloudTrail, CloudWatch)
├─ Rotate API keys quarterly
└─ Review IAM permissions regularly
```

---

## Implementation Notes

### Current State
- ✅ API Key authentication fully implemented (`/query` endpoint)
- ✅ Direct IAM authentication fully implemented (`/query-iam` endpoint)
- ✅ Lambda auto-detects authentication method
- ✅ Dual authentication supported in single Lambda function
- 📋 SSO mapping patterns designed but not deployed

### To Add SSO Support
1. Set up AWS IAM Identity Center
2. Configure SAML integration with corporate IdP
3. Update `iamUserService.ts` with SSO role patterns
4. Test with SSO temporary credentials
5. Document SSO login flow for users

### Testing Credentials
**API Keys:**
- Super User: `SUPER_USER_API_KEY_EXAMPLE`
- Dev User: `DEV_USER_API_KEY_EXAMPLE`

**IAM Users:**
- Dev User: `lf-lh-dev-user-o-sp5-dev` (Access Key: `YOUR_ACCESS_KEY_ID`)
- Super User: `lf-lh-super-user-o-sp5-dev`

---

## Security Considerations

### API Keys
- Store in secret manager (Vault, Secrets Manager) - never commit to git
- Rotate quarterly or after suspected compromise
- One key per external organization/job for granular revocation
- Monitor API Gateway CloudWatch metrics for abuse

### Direct IAM
- Never commit Access Keys to source control
- Enable MFA for human IAM users
- Use IAM roles for AWS services (never Access Keys)
- Rotate Access Keys every 90 days
- Monitor CloudTrail for unauthorized access patterns

### SSO with IAM
- Enforce MFA at IdP level
- Set session duration to minimum needed (1-2 hours for interactive use)
- Monitor IAM Identity Center logs
- Regularly audit IdP group → AWS role mappings
- Implement conditional access policies (IP restrictions, device compliance)

---

## Cost Comparison

| Component | API Key | Direct IAM | SSO with IAM |
|-----------|---------|------------|--------------|
| AWS IAM | Free | Free | Free |
| API Gateway | Free tier: 1M requests/month | Free tier: 1M requests/month | Free tier: 1M requests/month |
| IAM Identity Center | N/A | N/A | Free (AWS SSO) |
| Corporate IdP | N/A | N/A | $3-8/user/month (Okta, Azure AD) |
| **Total Monthly** | ~Free* | ~Free* | ~$150-400 for 50 users |

*Assumes within free tier; pay per request beyond 1M/month

---

**Document Version:** 1.0  
**Last Updated:** January 26, 2026  
**Project:** Lake Formation Access Control POC
