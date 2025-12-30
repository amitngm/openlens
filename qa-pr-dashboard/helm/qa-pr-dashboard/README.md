# FlowOps Helm Chart

This Helm chart deploys the FlowOps application on Kubernetes.

## Quick Start

```bash
# Install with default values
helm install qa-pr-dashboard ./helm/qa-pr-dashboard

# Install with custom values
helm install qa-pr-dashboard ./helm/qa-pr-dashboard -f my-values.yaml

# Upgrade existing release
helm upgrade qa-pr-dashboard ./helm/qa-pr-dashboard

# Uninstall
helm uninstall qa-pr-dashboard
```

## Configuration

The following table lists the configurable parameters and their default values:

| Parameter | Description | Default |
|-----------|-------------|---------|
| `replicaCount` | Number of replicas for each component | `2` |
| `image.frontend.repository` | Frontend image repository | `qa-pr-dashboard-frontend` |
| `image.frontend.tag` | Frontend image tag | `latest` |
| `image.api.repository` | API image repository | `qa-pr-dashboard-api` |
| `image.api.tag` | API image tag | `latest` |
| `service.frontend.type` | Frontend service type | `ClusterIP` |
| `service.frontend.port` | Frontend service port | `3000` |
| `service.api.type` | API service type | `ClusterIP` |
| `service.api.port` | API service port | `8000` |
| `ingress.enabled` | Enable ingress | `false` |
| `ingress.hosts[0].host` | Ingress hostname | `qa-pr-dashboard.local` |
| `resources.frontend.limits.cpu` | Frontend CPU limit | `500m` |
| `resources.frontend.limits.memory` | Frontend memory limit | `512Mi` |
| `resources.api.limits.cpu` | API CPU limit | `1000m` |
| `resources.api.limits.memory` | API memory limit | `1Gi` |
| `autoscaling.enabled` | Enable HPA | `false` |
| `autoscaling.minReplicas` | Minimum replicas | `2` |
| `autoscaling.maxReplicas` | Maximum replicas | `10` |
| `env.api.MONGODB_URI` | MongoDB connection string | `mongodb://mongodb-service:27017` |
| `env.api.DB_NAME` | Database name | `qa_pr_dashboard` |
| `env.frontend.API_URL` | Frontend API URL | `http://qa-pr-dashboard-api:8000/api` |

## Examples

### Deploy with Custom Image Registry

```yaml
image:
  frontend:
    repository: registry.example.com/qa-pr-dashboard-frontend
    tag: "v1.0.0"
  api:
    repository: registry.example.com/qa-pr-dashboard-api
    tag: "v1.0.0"
```

### Enable Ingress with TLS

```yaml
ingress:
  enabled: true
  className: "nginx"
  hosts:
    - host: dashboard.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: qa-pr-dashboard-tls
      hosts:
        - dashboard.example.com
```

### Enable Autoscaling

```yaml
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80
  targetMemoryUtilizationPercentage: 80
```

### Configure Secrets

Create a secret first:
```bash
kubectl create secret generic qa-pr-dashboard-secrets \
  --from-literal=github-token='your-token' \
  --from-literal=jira-base-url='https://your-jira.atlassian.net' \
  --from-literal=jira-email='your-email@example.com' \
  --from-literal=jira-api-token='your-token' \
  --from-literal=jira-project-key='PROJ'
```

Then enable in values.yaml:
```yaml
secrets:
  github:
    token: ""  # Uses secret
  jira:
    baseUrl: ""  # Uses secret
    email: ""  # Uses secret
    apiToken: ""  # Uses secret
    projectKey: ""  # Uses secret
```

## Troubleshooting

### Check Deployment Status
```bash
kubectl get deployments -l app.kubernetes.io/name=qa-pr-dashboard
```

### View Pod Logs
```bash
# Frontend
kubectl logs -l component=frontend -f

# API
kubectl logs -l component=api -f
```

### Port Forward for Testing
```bash
# Frontend
kubectl port-forward svc/qa-pr-dashboard-frontend 3000:3000

# API
kubectl port-forward svc/qa-pr-dashboard-api 8000:8000
```

### Check Services
```bash
kubectl get svc -l app.kubernetes.io/name=qa-pr-dashboard
```

### Describe Pods
```bash
kubectl describe pods -l app.kubernetes.io/name=qa-pr-dashboard
```

