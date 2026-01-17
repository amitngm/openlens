# QA Agent Security Guide

## Overview

The QA Agent is designed with security as a primary concern. This document outlines the security measures, best practices, and guidelines for safe operation.

## Core Security Principles

1. **No Production User Data**: Never use production user credentials
2. **Test Accounts Only**: All testing must use designated test accounts/tenants
3. **Namespace Isolation**: Agent operates only within its designated namespace
4. **Secret Protection**: All credentials are encrypted and never logged
5. **Rate Limiting**: Prevents resource exhaustion and runaway tests

## Security Guards

### ENV_GUARD

Prevents accidental execution against production environments.

**Behavior:**
- Blocks execution when `env` contains "prod", "production", "prd", or "live"
- Can be overridden via allowlist for specific flows
- `force_allow_prod` flag available for emergency use (logged)

**Configuration:**
```yaml
config:
  envGuardEnabled: true
  envGuardProdAllowlist:
    - health-check  # Only this flow can run in production
```

**API Behavior:**
```json
// Request blocked by ENV_GUARD
{
  "error": "Guard check failed",
  "message": "Execution blocked: Flow 'my-flow' is not allowed in production environment 'prod'",
  "flow_name": "my-flow",
  "environment": "prod"
}
```

### TEST_ACCOUNT_GUARD

Ensures tests only run with test account markers.

**Behavior:**
- Requires `testTenant: true` in the variables
- Optional: validates tenant naming conventions
- Logged warning if tenant name doesn't match test patterns

**Configuration:**
```yaml
config:
  testAccountGuardEnabled: true
```

**Required Variable:**
```json
{
  "flow_name": "public-ip-allocation",
  "env": "staging",
  "variables": {
    "testTenant": true,  // REQUIRED
    "region": "us-east-1"
  }
}
```

## Credential Management

### Kubernetes Secrets

All credentials are stored in Kubernetes Secrets:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: qa-agent-secrets
  namespace: qa-agent
type: Opaque
data:
  UI_USERNAME: <base64-encoded>
  UI_PASSWORD: <base64-encoded>
  API_TOKEN: <base64-encoded>
```

### Best Practices

1. **Use External Secret Management:**
   ```yaml
   secrets:
     create: false
     name: my-external-secret  # Reference existing secret
   ```

2. **Rotate Credentials Regularly:**
   - Rotate test account passwords quarterly
   - Rotate API tokens monthly

3. **Separate Test Accounts:**
   - Create dedicated service accounts for QA
   - Use naming convention: `svc-qa-*` or `qa-automation-*`

4. **Minimal Permissions:**
   - Test accounts should have minimal required permissions
   - Never use admin accounts for testing

## Secret Redaction

All logs automatically redact sensitive information.

### Patterns Redacted

| Pattern | Example | Redacted |
|---------|---------|----------|
| Bearer tokens | `Bearer abc123...` | `[REDACTED]` |
| Basic auth | `Basic dXNlcjpwYXNz` | `[REDACTED]` |
| Passwords | `password=secret123` | `password=[REDACTED]` |
| API keys | `api_key=sk-...` | `api_key=[REDACTED]` |
| JWTs | `eyJhbGci...` | `[REDACTED]` |

### Implementation

```python
# Python (Agent API)
from app.utils.logging import redact_dict

data = {"username": "test", "password": "secret123"}
safe_data = redact_dict(data)
# {"username": "test", "password": "[REDACTED]"}
```

```javascript
// JavaScript (Runner)
const { redactString } = require('./utils/logger');

const msg = "Bearer abc123xyz";
const safe = redactString(msg);
// "[REDACTED]"
```

## Network Security

### Network Policy

The Helm chart includes a NetworkPolicy that:

1. **Ingress**: Only allows traffic from pods in the same namespace
2. **Egress**: Allows:
   - DNS (port 53)
   - Kubernetes API (port 443, 6443)
   - Same namespace traffic
   - External HTTP/HTTPS (for target services)

```yaml
networkPolicy:
  enabled: true
  allowInNamespace: true
```

### Service Exposure

**Default: ClusterIP Only**
- Agent API is never exposed externally by default
- No Ingress is created
- Access only via port-forward or internal services

```yaml
agentApi:
  service:
    type: ClusterIP  # Never change to LoadBalancer
```

### TLS Recommendations

1. **Enable TLS for target services**
2. **Verify SSL certificates** (default)
3. **Use mTLS if available**

## RBAC Configuration

### Agent API Role

```yaml
rules:
  # Discovery (read-only)
  - apiGroups: [""]
    resources: ["services", "endpoints", "configmaps"]
    verbs: ["get", "list", "watch"]
  
  # Pod info (read-only)
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
  
  # Ingress (read-only)
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["get", "list", "watch"]
  
  # Jobs (for runner management)
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["get", "list", "watch", "create", "delete"]
```

### Runner Role

```yaml
rules:
  # Minimal read access for K8s checks
  - apiGroups: [""]
    resources: ["services", "endpoints", "pods"]
    verbs: ["get", "list"]
```

### Read-Only Mode

For maximum security, enable read-only mode:

```yaml
rbac:
  readOnly: true  # Disables pod/log access
```

## Rate Limiting

### Configuration

```yaml
config:
  maxConcurrentRuns: 5    # Max parallel test runs
  maxRunsPerFlow: 1       # Max runs per flow (prevents duplicates)
```

### API Response (Rate Limited)

```json
{
  "detail": "Rate limit exceeded for flow 'my-flow'. Please wait for current runs to complete."
}
```

## Audit Logging

### What's Logged

| Event | Log Level | Details |
|-------|-----------|---------|
| Run created | INFO | run_id, flow_name, env, user |
| Guard check failed | WARN | guard_type, flow_name, reason |
| Run completed | INFO | run_id, status, duration |
| Run failed | ERROR | run_id, error (redacted) |
| Secret access | DEBUG | key_name (not value) |

### Log Format

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "INFO",
  "logger": "run_manager",
  "message": "Created run run-abc123 for flow 'health-check'",
  "run_id": "run-abc123",
  "flow_name": "health-check",
  "environment": "staging"
}
```

## Security Checklist

### Pre-Deployment

- [ ] All secrets stored in Kubernetes Secrets
- [ ] Test account credentials (not production)
- [ ] ENV_GUARD enabled
- [ ] TEST_ACCOUNT_GUARD enabled
- [ ] NetworkPolicy enabled
- [ ] Service type is ClusterIP
- [ ] RBAC configured with minimal permissions
- [ ] Rate limits configured

### Operational

- [ ] Credentials rotated regularly
- [ ] Logs monitored for guard failures
- [ ] Test accounts audited quarterly
- [ ] Unused flows removed
- [ ] Old artifacts cleaned up

### Flow Development

- [ ] No hardcoded credentials in flows
- [ ] Variables use `${SECRET_NAME}` syntax
- [ ] `testTenant: true` required
- [ ] `allowed_environments` excludes production
- [ ] Teardown cleans up test data

## Incident Response

### Guard Failure Detected

1. Check logs for `Guard check failed` messages
2. Identify the source of the request
3. Verify configuration hasn't been modified
4. Review if legitimate use case requires allowlist entry

### Credential Exposure

1. Immediately rotate affected credentials
2. Review logs for unauthorized access
3. Update Kubernetes Secrets
4. Restart affected pods

### Unauthorized Access Attempt

1. Review NetworkPolicy configuration
2. Check for unauthorized pods in namespace
3. Audit RBAC bindings
4. Enable additional logging if needed

## Compliance Considerations

### SOC 2

- Secret redaction supports audit logging requirements
- RBAC provides access control documentation
- Rate limiting demonstrates resource protection

### GDPR

- No PII should be used in test data
- Test accounts should use synthetic data
- Artifact retention limits data storage

### PCI-DSS

- Network segmentation via NetworkPolicy
- Encrypted secrets at rest (Kubernetes)
- Access logging via audit logs
