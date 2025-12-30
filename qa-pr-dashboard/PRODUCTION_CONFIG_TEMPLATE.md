# Production Configuration Template

Use this template to document your production configuration. **DO NOT commit this file with real credentials.**

## Environment: Production

### MongoDB Configuration
```
MONGODB_URI: [YOUR_MONGODB_CONNECTION_STRING]
DB_NAME: qa_pr_dashboard
```

### Authentication
```
JWT_SECRET: [GENERATE_WITH: openssl rand -base64 32]
```

### Domain & Ingress
```
Domain: [YOUR_DOMAIN]
Ingress Class: nginx
SSL Certificate: [Let's Encrypt / Your Certificate]
```

### Docker Images
```
Frontend Image: [YOUR_REGISTRY]/qa-pr-dashboard-frontend:[TAG]
API Image: [YOUR_REGISTRY]/qa-pr-dashboard-api:[TAG]
Registry: [YOUR_REGISTRY_URL]
```

### Resource Limits
```
Frontend:
  CPU Request: 100m
  CPU Limit: 500m
  Memory Request: 256Mi
  Memory Limit: 512Mi
  Replicas: 2

API:
  CPU Request: 100m
  CPU Limit: 500m
  Memory Request: 256Mi
  Memory Limit: 512Mi
  Replicas: 2
```

### Initial Users
```
Admin:
  Username: [CHANGE_FROM_DEFAULT]
  Password: [CHANGE_FROM_DEFAULT]
  Email: [ADMIN_EMAIL]
```

### Jira Configuration (Global - Admin)
```
Base URL: [YOUR_JIRA_URL]
Email: [JIRA_EMAIL]
API Token: [JIRA_API_TOKEN]
Project Key: [PROJECT_KEY]
Labels: [OPTIONAL_LABELS]
```

### GitHub Configuration (Global - Admin)
```
Token: [GITHUB_TOKEN]
Organization: [ORG_NAME]
Username: [GITHUB_USERNAME]
Repositories: [REPO_LIST]
```

### Kubernetes Cluster
```
Cluster Name: [CLUSTER_NAME]
Namespace: qa-pr-dashboard
Context: [KUBECTL_CONTEXT]
```

### Monitoring
```
Solution: [PROMETHEUS/DATADOG/etc]
Endpoint: [MONITORING_ENDPOINT]
```

### Backup
```
MongoDB Backup: [SCHEDULE]
Retention: [DAYS]
Location: [BACKUP_LOCATION]
```

---

**Instructions:**
1. Copy this template
2. Fill in your actual values
3. Store securely (password manager, secure vault)
4. **DO NOT commit to git**
