# Tempo/Jaeger Deployment - Same Namespace Configuration

## ✅ Confirmed: Tempo and Jaeger Deploy in Same Namespace

**Tempo and Jaeger are configured to deploy in the same namespace (`qa-pr-dashboard`) as your application services.**

## Architecture

```
┌─────────────────────────────────────┐
│  qa-pr-dashboard namespace          │
│                                     │
│  Application Services:              │
│  ├── api-server                    │
│  ├── frontend                       │
│  └── other services...              │
│                                     │
│  Tracing Infrastructure:           │
│  ├── tempo (StatefulSet)           │
│  └── jaeger (Deployment, optional) │
│                                     │
└─────────────────────────────────────┘
```

## Benefits of Same Namespace

1. **Simpler DNS**: Use short service names (`tempo` instead of `tempo.observability.svc.cluster.local`)
2. **Easier Network Policies**: Configure policies within single namespace
3. **Shared Resources**: Same resource quotas and limits
4. **Simpler RBAC**: Single namespace permissions

## Deployment Files

### Created Files:
- `k8s/tempo-statefulset.yaml` - Tempo StatefulSet, Service, and ConfigMap
- `k8s/jaeger-deployment.yaml` - Jaeger Deployment and Service (optional)
- `k8s/README-TRACING.md` - Detailed deployment guide

## Quick Deployment

### 1. Deploy Tempo
```bash
kubectl apply -f k8s/tempo-statefulset.yaml
```

### 2. Verify Deployment
```bash
kubectl get pods -n qa-pr-dashboard -l app=tempo
kubectl get svc -n qa-pr-dashboard tempo
```

### 3. Access Tempo UI
```bash
kubectl port-forward -n qa-pr-dashboard svc/tempo 3200:3200
# Open http://localhost:3200
```

## Service Endpoints (Same Namespace)

Your application services can connect using **short DNS names**:

```javascript
// In your application code
const tempoEndpoint = process.env.TEMPO_ENDPOINT || 'http://tempo:4317'
// Short name works because it's in the same namespace!
```

### Available Endpoints:
- **Tempo UI**: `http://tempo:3200` (or `tempo.qa-pr-dashboard.svc.cluster.local:3200`)
- **Tempo OTLP gRPC**: `http://tempo:4317`
- **Tempo OTLP HTTP**: `http://tempo:4318`
- **Jaeger UI**: `http://jaeger:16686` (if deployed)
- **Jaeger OTLP**: `http://jaeger:4317` (if deployed)

## Configuration Updates

The API server ConfigMap (`k8s/configmap-api.yaml`) has been updated with:
- `TEMPO_ENDPOINT: "http://tempo:4317"` (short name)
- `JAEGER_ENDPOINT: "http://jaeger:4317"` (short name)
- Tracing enabled by default

## Verification

After deployment, verify connectivity:

```bash
# Check if Tempo is ready
kubectl exec -n qa-pr-dashboard deployment/qa-pr-dashboard-api -- \
  curl -s http://tempo:3200/ready

# Check if traces are being received
kubectl logs -n qa-pr-dashboard -l app=tempo --tail=20
```

## Storage

- Tempo uses PersistentVolumeClaim (50Gi default)
- Storage persists across pod restarts
- Adjustable in `tempo-statefulset.yaml`

## Resource Requirements

### Tempo
- CPU: 500m request, 2000m limit
- Memory: 2Gi request, 4Gi limit
- Storage: 50Gi (configurable)

## Summary

✅ **Confirmed**: Tempo and Jaeger deploy in the **same namespace** (`qa-pr-dashboard`) as your application services.

✅ **Benefits**: Simpler configuration, easier networking, shared resources.

✅ **Ready to Deploy**: All manifests created and configured for same-namespace deployment.

