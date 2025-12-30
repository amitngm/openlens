# Docker and Helm Deployment Guide

This guide explains how to build Docker images and deploy FlowOps using Helm.

## Prerequisites

- Docker installed
- Kubernetes cluster running
- Helm 3.x installed
- kubectl configured to access your cluster

## Building Docker Images

### Build Frontend Image

```bash
cd qa-pr-dashboard
docker build -t qa-pr-dashboard-frontend:latest .
```

### Build API Server Image

```bash
cd qa-pr-dashboard/api-server
docker build -t qa-pr-dashboard-api:latest .
```

### Build Both Images

```bash
# From project root
docker build -t qa-pr-dashboard-frontend:latest -f qa-pr-dashboard/Dockerfile qa-pr-dashboard/
docker build -t qa-pr-dashboard-api:latest -f qa-pr-dashboard/api-server/Dockerfile qa-pr-dashboard/api-server/
```

### Push to Container Registry

If using a container registry (e.g., Docker Hub, ECR, GCR):

```bash
# Tag images
docker tag qa-pr-dashboard-frontend:latest your-registry/qa-pr-dashboard-frontend:latest
docker tag qa-pr-dashboard-api:latest your-registry/qa-pr-dashboard-api:latest

# Push images
docker push your-registry/qa-pr-dashboard-frontend:latest
docker push your-registry/qa-pr-dashboard-api:latest
```

## Local Testing with Docker Compose

```bash
cd qa-pr-dashboard
docker-compose up -d
```

This will start:
- Frontend on http://localhost:3000
- API server on http://localhost:8000
- MongoDB on localhost:27017

To stop:
```bash
docker-compose down
```

## Helm Deployment

### 1. Update values.yaml

Edit `helm/qa-pr-dashboard/values.yaml` to configure:
- Image repositories and tags
- Resource limits
- Environment variables
- Ingress settings
- MongoDB connection

### 2. Create Secrets (Optional)

If you need to store sensitive data (GitHub tokens, Jira credentials):

```bash
kubectl create secret generic qa-pr-dashboard-secrets \
  --from-literal=github-token='your-github-token' \
  --from-literal=jira-base-url='https://your-jira.atlassian.net' \
  --from-literal=jira-email='your-email@example.com' \
  --from-literal=jira-api-token='your-jira-token' \
  --from-literal=jira-project-key='PROJ'
```

Then update `values.yaml` to enable secrets:
```yaml
secrets:
  github:
    token: ""  # Will use secret
  jira:
    baseUrl: ""  # Will use secret
    email: ""  # Will use secret
    apiToken: ""  # Will use secret
    projectKey: ""  # Will use secret
```

### 3. Install Helm Chart

```bash
# Install with default values
helm install qa-pr-dashboard ./helm/qa-pr-dashboard

# Install with custom values file
helm install qa-pr-dashboard ./helm/qa-pr-dashboard -f my-values.yaml

# Install with custom namespace
helm install qa-pr-dashboard ./helm/qa-pr-dashboard --namespace qa-dashboard --create-namespace
```

### 4. Upgrade Helm Release

```bash
helm upgrade qa-pr-dashboard ./helm/qa-pr-dashboard

# With custom values
helm upgrade qa-pr-dashboard ./helm/qa-pr-dashboard -f my-values.yaml
```

### 5. Uninstall

```bash
helm uninstall qa-pr-dashboard
```

## Configuration

### Environment Variables

Key environment variables in `values.yaml`:

**Frontend:**
- `API_URL`: Backend API URL (default: `http://qa-pr-dashboard-api:8000/api`)
- `NEXT_PUBLIC_API_URL`: Public API URL for client-side requests

**API Server:**
- `MONGODB_URI`: MongoDB connection string
- `DB_NAME`: Database name
- `SKIP_MONGO`: Set to "true" to skip MongoDB connection

### Ingress

To enable ingress, set `ingress.enabled: true` in `values.yaml` and configure:
- Hostname
- TLS certificates
- Annotations (for your ingress controller)

### Autoscaling

Enable horizontal pod autoscaling:
```yaml
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80
```

## Troubleshooting

### Check Pod Status
```bash
kubectl get pods -l app.kubernetes.io/name=qa-pr-dashboard
```

### View Logs
```bash
# Frontend logs
kubectl logs -l component=frontend -f

# API logs
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

## Production Considerations

1. **Use proper image tags** (not `latest`) for production
2. **Enable resource limits** in values.yaml
3. **Set up proper ingress** with TLS
4. **Configure persistent storage** for MongoDB if using
5. **Set up monitoring** and logging
6. **Use secrets** for sensitive credentials
7. **Enable autoscaling** for high availability
8. **Configure health checks** properly

