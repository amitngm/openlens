# FlowOps - Helm Deployment Guide

## Best Practices for Production Deployment

### 1. Image Configuration

**✅ Recommended:**
```yaml
image:
  frontend:
    repository: amitngm/qa-pr-dashboard-frontend
    pullPolicy: Always  # Always pull latest
    tag: "v1.0.0"  # Use specific version tags, not "latest"
```

**❌ Avoid:**
- Using `latest` tag in production
- Using `IfNotPresent` pull policy (may use stale images)

### 2. High Availability (HA)

**Minimum Configuration:**
- `replicaCount: 3` - Run at least 3 replicas
- Enable autoscaling: `autoscaling.enabled: true`
- Use pod anti-affinity to spread pods across nodes
- Set resource requests/limits

**Example:**
```yaml
replicaCount: 3
autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 10
affinity:
  podAntiAffinity:
    preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 100
        podAffinityTerm:
          topologyKey: kubernetes.io/hostname
```

### 3. Resource Management

**Frontend:**
```yaml
resources:
  frontend:
    requests:
      cpu: 200m      # Guaranteed CPU
      memory: 256Mi  # Guaranteed Memory
    limits:
      cpu: 1000m     # Max CPU
      memory: 512Mi  # Max Memory
```

**API Server:**
```yaml
resources:
  api:
    requests:
      cpu: 500m
      memory: 512Mi
    limits:
      cpu: 2000m
      memory: 2Gi
```

### 4. Security Best Practices

**Security Context:**
```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1001
  allowPrivilegeEscalation: false
  capabilities:
    drop:
      - ALL
```

**Secrets Management:**
- Never commit secrets to git
- Use Kubernetes Secrets or external secret managers (AWS Secrets Manager, HashiCorp Vault)
- Use imagePullSecrets for private registries

**Create secrets:**
```bash
kubectl create secret generic qa-pr-dashboard-secrets \
  --from-literal=github-token=your-token \
  --from-literal=jira-api-token=your-token \
  --from-literal=jira-email=your-email \
  --from-literal=jira-base-url=https://your-jira.com \
  --from-literal=jira-project-key=PROJ
```

### 5. Ingress Configuration

**Production Ingress:**
```yaml
ingress:
  enabled: true
  className: "nginx"
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
  hosts:
    - host: qa-pr-dashboard.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: qa-pr-dashboard-tls
      hosts:
        - qa-pr-dashboard.example.com
```

### 6. Health Checks

**Recommended Configuration:**
```yaml
livenessProbe:
  api:
    httpGet:
      path: /api/health
      port: 8000
    initialDelaySeconds: 30
    periodSeconds: 10
    timeoutSeconds: 5
    failureThreshold: 3

readinessProbe:
  api:
    httpGet:
      path: /api/health
      port: 8000
    initialDelaySeconds: 10
    periodSeconds: 5
    timeoutSeconds: 3
    failureThreshold: 3

startupProbe:  # Helps with slow-starting apps
  api:
    httpGet:
      path: /api/health
      port: 8000
    initialDelaySeconds: 10
    periodSeconds: 10
    failureThreshold: 30
```

### 7. Database Configuration

**For Production:**
- Use managed database services (MongoDB Atlas, AWS DocumentDB)
- Enable connection pooling
- Configure backup and disaster recovery
- Use separate databases for different environments

```yaml
env:
  api:
    MONGODB_URI: "mongodb+srv://user:pass@cluster.mongodb.net/qa_pr_dashboard?retryWrites=true&w=majority"
```

### 8. Monitoring and Logging

**Recommended:**
- Enable Prometheus metrics
- Configure serviceMonitor if using Prometheus Operator
- Set up log aggregation (ELK, Loki, CloudWatch)
- Add pod annotations for scraping

```yaml
podAnnotations:
  prometheus.io/scrape: "true"
  prometheus.io/port: "8000"
  prometheus.io/path: "/metrics"
```

### 9. Deployment Strategies

**Rolling Update (Default):**
```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1
    maxUnavailable: 0  # Zero-downtime deployment
```

**Blue-Green or Canary:**
- Use Argo Rollouts or Flagger for advanced strategies
- Test in staging before production

### 10. Backup and Disaster Recovery

- Regular database backups
- Export Helm values and keep in version control
- Document rollback procedures
- Test disaster recovery regularly

## Deployment Commands

### Install with Production Values

```bash
# 1. Create namespace
kubectl create namespace qa-pr-dashboard

# 2. Create secrets
kubectl create secret generic qa-pr-dashboard-secrets \
  --from-literal=github-token=xxx \
  --from-literal=jira-api-token=xxx \
  --from-literal=jira-email=xxx \
  --from-literal=jira-base-url=https://xxx.atlassian.net \
  --from-literal=jira-project-key=PROJ \
  -n qa-pr-dashboard

# 3. Install Helm chart
helm install qa-pr-dashboard ./helm/qa-pr-dashboard \
  -f ./helm/qa-pr-dashboard/values-production.yaml \
  --namespace qa-pr-dashboard \
  --create-namespace

# 4. Verify deployment
kubectl get pods -n qa-pr-dashboard
kubectl get services -n qa-pr-dashboard
kubectl get ingress -n qa-pr-dashboard
```

### Upgrade Deployment

```bash
helm upgrade qa-pr-dashboard ./helm/qa-pr-dashboard \
  -f ./helm/qa-pr-dashboard/values-production.yaml \
  --namespace qa-pr-dashboard
```

### Rollback Deployment

```bash
# View release history
helm history qa-pr-dashboard -n qa-pr-dashboard

# Rollback to previous version
helm rollback qa-pr-dashboard -n qa-pr-dashboard

# Rollback to specific revision
helm rollback qa-pr-dashboard 2 -n qa-pr-dashboard
```

### Uninstall

```bash
helm uninstall qa-pr-dashboard -n qa-pr-dashboard
```

## Environment-Specific Configurations

### Development
```bash
helm install qa-pr-dashboard ./helm/qa-pr-dashboard \
  --set replicaCount=1 \
  --set autoscaling.enabled=false \
  --set ingress.enabled=false \
  --namespace qa-pr-dashboard-dev
```

### Staging
```bash
helm install qa-pr-dashboard ./helm/qa-pr-dashboard \
  -f ./helm/qa-pr-dashboard/values-production.yaml \
  --set replicaCount=2 \
  --set image.tag=v1.0.0-rc1 \
  --namespace qa-pr-dashboard-staging
```

### Production
```bash
helm install qa-pr-dashboard ./helm/qa-pr-dashboard \
  -f ./helm/qa-pr-dashboard/values-production.yaml \
  --namespace qa-pr-dashboard \
  --create-namespace
```

## Troubleshooting

### Check Pod Status
```bash
kubectl get pods -n qa-pr-dashboard
kubectl describe pod <pod-name> -n qa-pr-dashboard
kubectl logs <pod-name> -n qa-pr-dashboard
```

### Check Service
```bash
kubectl get svc -n qa-pr-dashboard
kubectl describe svc qa-pr-dashboard-api -n qa-pr-dashboard
```

### Check Ingress
```bash
kubectl get ingress -n qa-pr-dashboard
kubectl describe ingress -n qa-pr-dashboard
```

### Port Forward for Testing
```bash
# Frontend
kubectl port-forward svc/qa-pr-dashboard-frontend 3000:3000 -n qa-pr-dashboard

# API
kubectl port-forward svc/qa-pr-dashboard-api 8000:8000 -n qa-pr-dashboard
```









