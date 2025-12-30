# Tracing Backend Deployment (Same Namespace)

This directory contains Kubernetes manifests for deploying Tempo and Jaeger tracing backends in the **same namespace** as your application services (`qa-pr-dashboard`).

## Deployment Architecture

```
┌─────────────────────────────┐
│  qa-pr-dashboard namespace   │
│                             │
│  ┌──────────────────────┐   │
│  │  Application Services │   │
│  │  - api-server        │   │
│  │  - frontend          │   │
│  └──────────┬───────────┘   │
│             │                │
│             │ Sends traces    │
│             │                 │
│  ┌──────────▼───────────┐   │
│  │  Tracing Backends     │   │
│  │  - tempo             │   │
│  │  - jaeger (optional)  │   │
│  └──────────────────────┘   │
└─────────────────────────────┘
```

## Files

- `tempo-statefulset.yaml` - Tempo deployment (StatefulSet) with Service and ConfigMap
- `jaeger-deployment.yaml` - Jaeger deployment (optional alternative)

## Deployment Steps

### 1. Deploy Tempo (Recommended)

```bash
# Apply Tempo manifests
kubectl apply -f k8s/tempo-statefulset.yaml

# Verify deployment
kubectl get pods -n qa-pr-dashboard -l app=tempo
kubectl get svc -n qa-pr-dashboard tempo
```

### 2. Deploy Jaeger (Optional Alternative)

```bash
# Apply Jaeger manifests
kubectl apply -f k8s/jaeger-deployment.yaml

# Verify deployment
kubectl get pods -n qa-pr-dashboard -l app=jaeger
kubectl get svc -n qa-pr-dashboard jaeger
```

### 3. Configure Application Services

Update your application deployments to send traces to Tempo:

```yaml
# In your deployment YAML
env:
- name: TEMPO_ENDPOINT
  value: "http://tempo:4317"  # Short name works in same namespace
  # Or use full DNS:
  # value: "http://tempo.qa-pr-dashboard.svc.cluster.local:4317"
```

## Service Endpoints

### Tempo
- **UI**: `http://tempo.qa-pr-dashboard.svc.cluster.local:3200`
- **OTLP gRPC**: `http://tempo.qa-pr-dashboard.svc.cluster.local:4317`
- **OTLP HTTP**: `http://tempo.qa-pr-dashboard.svc.cluster.local:4318`

### Jaeger
- **UI**: `http://jaeger.qa-pr-dashboard.svc.cluster.local:16686`
- **OTLP gRPC**: `http://jaeger.qa-pr-dashboard.svc.cluster.local:4317`
- **OTLP HTTP**: `http://jaeger.qa-pr-dashboard.svc.cluster.local:4318`

## Accessing the UI (Port Forward)

### Tempo UI
```bash
kubectl port-forward -n qa-pr-dashboard svc/tempo 3200:3200
# Access at http://localhost:3200
```

### Jaeger UI
```bash
kubectl port-forward -n qa-pr-dashboard svc/jaeger 16686:16686
# Access at http://localhost:16686
```

## Benefits of Same Namespace Deployment

1. **Simpler Configuration**: Services can use short DNS names (`tempo` instead of `tempo.observability.svc.cluster.local`)
2. **Network Policies**: Easier to configure network policies within the same namespace
3. **Resource Quotas**: Shared resource quotas with application services
4. **RBAC**: Simpler role-based access control

## Storage Considerations

- Tempo uses PersistentVolumeClaims for trace storage
- Default storage: 50Gi (adjustable in `tempo-statefulset.yaml`)
- Storage class: Uses cluster default (can be customized)

## Resource Requirements

### Tempo
- **CPU**: 500m request, 2000m limit
- **Memory**: 2Gi request, 4Gi limit
- **Storage**: 50Gi (configurable)

### Jaeger
- **CPU**: 500m request, 2000m limit
- **Memory**: 1Gi request, 2Gi limit
- **Storage**: In-memory (all-in-one mode)

## Troubleshooting

### Check Tempo Status
```bash
kubectl logs -n qa-pr-dashboard -l app=tempo --tail=50
kubectl describe pod -n qa-pr-dashboard -l app=tempo
```

### Check Service Connectivity
```bash
# From within a pod in the same namespace
curl http://tempo:3200/ready
```

### Verify Traces are Being Received
```bash
# Check Tempo metrics
kubectl port-forward -n qa-pr-dashboard svc/tempo 3200:3200
# Then access http://localhost:3200/metrics
```

## Updating Configuration

To update Tempo configuration:

1. Edit `tempo-statefulset.yaml` ConfigMap section
2. Apply changes: `kubectl apply -f k8s/tempo-statefulset.yaml`
3. Restart Tempo pods: `kubectl rollout restart statefulset/tempo -n qa-pr-dashboard`

