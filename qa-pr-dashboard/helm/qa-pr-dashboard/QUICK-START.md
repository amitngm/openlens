# Quick Start - Helm Deployment

## Minimal Production Deployment

### 1. Create Namespace
```bash
kubectl create namespace qa-pr-dashboard
```

### 2. Create Secrets
```bash
kubectl create secret generic qa-pr-dashboard-secrets \
  --from-literal=github-token=your-github-token \
  --from-literal=jira-api-token=your-jira-token \
  --from-literal=jira-email=your-email@example.com \
  --from-literal=jira-base-url=https://your-domain.atlassian.net \
  --from-literal=jira-project-key=PROJ \
  -n qa-pr-dashboard
```

### 3. Install with Production Values
```bash
helm install qa-pr-dashboard ./helm/qa-pr-dashboard \
  -f ./helm/qa-pr-dashboard/values-production.yaml \
  --namespace qa-pr-dashboard
```

### 4. Update values-production.yaml
**Before installing, update:**
- `image.tag` - Use specific version (not "latest")
- `ingress.hosts[0].host` - Your domain name
- `env.api.MONGODB_URI` - Your MongoDB connection string
- `env.frontend.NEXT_PUBLIC_API_URL` - Your public API URL

### 5. Verify Installation
```bash
# Check pods
kubectl get pods -n qa-pr-dashboard

# Check services
kubectl get svc -n qa-pr-dashboard

# Check ingress
kubectl get ingress -n qa-pr-dashboard

# View logs
kubectl logs -f deployment/qa-pr-dashboard-api -n qa-pr-dashboard
```

## Recommended Production Settings Summary

| Setting | Value | Reason |
|---------|-------|--------|
| `replicaCount` | 3 | High availability |
| `autoscaling.enabled` | true | Handle traffic spikes |
| `image.pullPolicy` | Always | Always use latest |
| `ingress.enabled` | true | External access with TLS |
| `resources` | Set requests/limits | Resource management |
| `livenessProbe` | Enabled | Container health |
| `readinessProbe` | Enabled | Traffic routing |
| `securityContext.runAsNonRoot` | true | Security best practice |

## Essential Checklist

- [ ] Use specific image tags (not "latest")
- [ ] Enable autoscaling
- [ ] Configure ingress with TLS
- [ ] Set resource limits
- [ ] Configure health checks
- [ ] Create secrets properly
- [ ] Use managed database (not embedded)
- [ ] Enable monitoring
- [ ] Configure backup strategy
- [ ] Test rollback procedure











