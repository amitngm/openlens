# Kubernetes Deployment for FlowOps

This directory contains Kubernetes manifests for deploying FlowOps to a Kubernetes cluster.

## Prerequisites

- Kubernetes cluster (v1.20+)
- kubectl configured to access your cluster
- Docker images pushed to registry (default: `amitngm/qa-pr-dashboard-frontend:latest` and `amitngm/qa-pr-dashboard-api:latest`)

## Quick Start

### Pre-Deployment (Production)

1. **Create namespace:**
   ```bash
   kubectl apply -f namespace.yaml
   ```

2. **Create Secrets (REQUIRED for production):**
   ```bash
   # MongoDB connection string
   kubectl create secret generic mongodb-secret \
     --namespace qa-pr-dashboard \
     --from-literal=mongodb-uri='mongodb+srv://user:pass@cluster.mongodb.net/qa_pr_dashboard'
   
   # JWT secret (generate with: openssl rand -base64 32)
   kubectl create secret generic jwt-secret \
     --namespace qa-pr-dashboard \
     --from-literal=jwt-secret='your-strong-random-secret-key'
   ```

3. **Create ConfigMaps:**
   ```bash
   kubectl apply -f configmap-frontend.yaml
   kubectl apply -f configmap-api.yaml
   ```

4. **Deploy services:**
   ```bash
   kubectl apply -f service-frontend.yaml
   kubectl apply -f service-api.yaml
   ```

5. **Deploy applications:**
   ```bash
   kubectl apply -f deployment-frontend.yaml
   kubectl apply -f deployment-api.yaml
   ```

6. **Create Ingress:**
   ```bash
   kubectl apply -f ingress.yaml
   ```

## Configuration

### Update Image Repository

Edit the deployment files to change the image repository:
- `deployment-frontend.yaml`: Update `image: amitngm/qa-pr-dashboard-frontend:latest`
- `deployment-api.yaml`: Update `image: amitngm/qa-pr-dashboard-api:latest`

### Update API URL

Edit `configmap-frontend.yaml` to set the correct API URL:
```yaml
API_URL: "http://qa-pr-dashboard-api:8000/api"
NEXT_PUBLIC_API_URL: "http://qa-pr-dashboard-api:8000/api"
```

### Update MongoDB Connection

Edit `configmap-api.yaml` to set the correct MongoDB URI:
```yaml
MONGODB_URI: "mongodb://mongodb-service:27017"
```

### Update Ingress Host

Edit `ingress.yaml` to set your domain:
```yaml
- host: qa-pr-dashboard.local  # Change to your domain
```

## Verify Deployment

```bash
# Check pods
kubectl get pods -n qa-pr-dashboard

# Check services
kubectl get svc -n qa-pr-dashboard

# Check ingress
kubectl get ingress -n qa-pr-dashboard

# View logs
kubectl logs -f deployment/qa-pr-dashboard-frontend -n qa-pr-dashboard
kubectl logs -f deployment/qa-pr-dashboard-api -n qa-pr-dashboard
```

## Scaling

To scale the deployments:
```bash
kubectl scale deployment qa-pr-dashboard-frontend --replicas=3 -n qa-pr-dashboard
kubectl scale deployment qa-pr-dashboard-api --replicas=3 -n qa-pr-dashboard
```

## Cleanup

To remove all resources:
```bash
kubectl delete namespace qa-pr-dashboard
```

## Using Helm (Alternative)

If you prefer using Helm, see the `helm/` directory for Helm charts:
```bash
cd helm/qa-pr-dashboard
helm install qa-pr-dashboard . -f values.yaml
```
