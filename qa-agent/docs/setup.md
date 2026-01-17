# QA Agent - Kubernetes Setup Guide

This guide covers deploying the QA Agent (API + UI) to a Kubernetes cluster using Helm.

## Prerequisites

- Kubernetes cluster (1.21+)
- Helm 3.x
- `kubectl` configured to access your cluster
- Sufficient RBAC permissions to create ServiceAccounts, Roles, and PVCs

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Kubernetes Cluster                      │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                   qa-agent namespace                 │    │
│  │                                                      │    │
│  │  ┌──────────────┐        ┌──────────────────────┐   │    │
│  │  │  qa-agent-ui │───────▶│   qa-agent-api       │   │    │
│  │  │  (Next.js)   │        │   (FastAPI+Playwright)│   │    │
│  │  │  ClusterIP   │        │   ClusterIP          │   │    │
│  │  └──────────────┘        └──────────────────────┘   │    │
│  │         │                         │                 │    │
│  │         │                    ┌────┴────┐            │    │
│  │   (optional)                 │   PVC   │            │    │
│  │    Ingress                   │  /data  │            │    │
│  │  (internal only)             └─────────┘            │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  NetworkPolicy: Only same-namespace pods can access API     │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Create Namespace

```bash
kubectl create namespace qa-agent
```

### 2. Deploy QA Agent API

```bash
# From repository root
cd qa-agent

# Install API chart
helm install qa-agent-api ./charts/qa-agent-api \
  --namespace qa-agent \
  --set image.repository=amitngm/qa-agent \
  --set image.tag=latest
```

### 3. Deploy QA Agent UI

```bash
# Install UI chart
helm install qa-agent-ui ./charts/qa-agent-ui \
  --namespace qa-agent \
  --set image.repository=amitngm/qa-agent-ui \
  --set image.tag=latest \
  --set qaAgentApi.serviceName=qa-agent-api-qa-agent-api
```

### 4. Access the UI

**Option A: Port Forward (Development)**

```bash
kubectl port-forward svc/qa-agent-ui-qa-agent-ui 3000:3000 -n qa-agent
# Open http://localhost:3000
```

**Option B: Ingress (Internal Production)**

```bash
helm upgrade qa-agent-ui ./charts/qa-agent-ui \
  --namespace qa-agent \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=qa-agent.internal.yourcompany.com \
  --set ingress.hosts[0].paths[0].path=/ \
  --set ingress.hosts[0].paths[0].pathType=Prefix
```

---

## Detailed Configuration

### QA Agent API Values

| Parameter | Description | Default |
|-----------|-------------|---------|
| `image.repository` | Docker image repository | `amitngm/qa-agent` |
| `image.tag` | Docker image tag | `latest` |
| `replicaCount` | Number of replicas | `1` |
| `persistence.enabled` | Enable PVC for /data | `true` |
| `persistence.size` | PVC size | `5Gi` |
| `persistence.storageClass` | Storage class (empty = default) | `""` |
| `networkPolicy.enabled` | Enable NetworkPolicy | `true` |
| `rbac.create` | Create Role/RoleBinding | `true` |
| `env` | Environment variables | See values.yaml |

### QA Agent UI Values

| Parameter | Description | Default |
|-----------|-------------|---------|
| `image.repository` | Docker image repository | `amitngm/qa-agent-ui` |
| `image.tag` | Docker image tag | `latest` |
| `qaAgentApi.serviceName` | API service name | `qa-agent-api` |
| `qaAgentApi.port` | API service port | `8080` |
| `ingress.enabled` | Enable Ingress | `false` |
| `ingress.className` | Ingress class | `nginx` |
| `networkPolicy.enabled` | Enable NetworkPolicy | `true` |

---

## Installation Examples

### Basic Installation

```bash
# Create namespace
kubectl create namespace qa-agent

# Install API
helm install qa-agent-api ./charts/qa-agent-api -n qa-agent

# Install UI
helm install qa-agent-ui ./charts/qa-agent-ui -n qa-agent \
  --set qaAgentApi.serviceName=qa-agent-api-qa-agent-api
```

### Custom Storage Class

```bash
helm install qa-agent-api ./charts/qa-agent-api -n qa-agent \
  --set persistence.storageClass=fast-ssd \
  --set persistence.size=10Gi
```

### Allow Production Testing

```bash
helm install qa-agent-api ./charts/qa-agent-api -n qa-agent \
  --set env[0].name=ALLOW_PROD \
  --set env[0].value="true"
```

### Internal Ingress with TLS

```bash
helm install qa-agent-ui ./charts/qa-agent-ui -n qa-agent \
  --set ingress.enabled=true \
  --set ingress.className=nginx \
  --set ingress.annotations."nginx\.ingress\.kubernetes\.io/whitelist-source-range"="10.0.0.0/8" \
  --set ingress.hosts[0].host=qa-agent.internal.example.com \
  --set ingress.hosts[0].paths[0].path=/ \
  --set ingress.hosts[0].paths[0].pathType=Prefix \
  --set ingress.tls[0].secretName=qa-agent-tls \
  --set ingress.tls[0].hosts[0]=qa-agent.internal.example.com
```

### Use Existing PVC

```bash
# First create PVC manually
kubectl apply -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-qa-agent-data
  namespace: qa-agent
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 20Gi
EOF

# Then install with existing claim
helm install qa-agent-api ./charts/qa-agent-api -n qa-agent \
  --set persistence.existingClaim=my-qa-agent-data
```

---

## Verify Installation

### Check Pods

```bash
kubectl get pods -n qa-agent
```

Expected output:
```
NAME                                        READY   STATUS    RESTARTS   AGE
qa-agent-api-qa-agent-api-xxx-xxx           1/1     Running   0          2m
qa-agent-ui-qa-agent-ui-xxx-xxx             1/1     Running   0          1m
```

### Check Services

```bash
kubectl get svc -n qa-agent
```

Expected output:
```
NAME                        TYPE        CLUSTER-IP     PORT(S)    AGE
qa-agent-api-qa-agent-api   ClusterIP   10.96.x.x      8080/TCP   2m
qa-agent-ui-qa-agent-ui     ClusterIP   10.96.x.x      3000/TCP   1m
```

### Check PVC

```bash
kubectl get pvc -n qa-agent
```

Expected output:
```
NAME                            STATUS   VOLUME     CAPACITY   ACCESS MODES
qa-agent-api-qa-agent-api-data  Bound    pvc-xxx    5Gi        RWO
```

### Check RBAC

```bash
kubectl get role,rolebinding -n qa-agent
```

### Check NetworkPolicy

```bash
kubectl get networkpolicy -n qa-agent
```

### Test API Health

```bash
kubectl exec -it deploy/qa-agent-ui-qa-agent-ui -n qa-agent -- \
  curl -s http://qa-agent-api-qa-agent-api:8080/health
```

---

## Upgrade

```bash
# Upgrade API
helm upgrade qa-agent-api ./charts/qa-agent-api -n qa-agent \
  --set image.tag=v2.1.0

# Upgrade UI
helm upgrade qa-agent-ui ./charts/qa-agent-ui -n qa-agent \
  --set image.tag=v2.1.0
```

---

## Uninstall

```bash
# Remove UI
helm uninstall qa-agent-ui -n qa-agent

# Remove API
helm uninstall qa-agent-api -n qa-agent

# Optionally delete PVC (WARNING: deletes all artifacts!)
kubectl delete pvc qa-agent-api-qa-agent-api-data -n qa-agent

# Delete namespace
kubectl delete namespace qa-agent
```

---

## Troubleshooting

### UI Cannot Reach API

1. Check NetworkPolicy is allowing traffic:
```bash
kubectl describe networkpolicy -n qa-agent
```

2. Verify service names match:
```bash
kubectl get svc -n qa-agent
```

3. Test connectivity from UI pod:
```bash
kubectl exec -it deploy/qa-agent-ui-qa-agent-ui -n qa-agent -- \
  curl -v http://qa-agent-api-qa-agent-api:8080/health
```

### PVC Not Binding

1. Check storage class:
```bash
kubectl get storageclass
```

2. Check PVC events:
```bash
kubectl describe pvc -n qa-agent
```

### Pod Not Starting

1. Check pod events:
```bash
kubectl describe pod -l app.kubernetes.io/name=qa-agent-api -n qa-agent
```

2. Check logs:
```bash
kubectl logs -l app.kubernetes.io/name=qa-agent-api -n qa-agent
```

### Permission Denied (RBAC)

1. Check ServiceAccount:
```bash
kubectl get sa -n qa-agent
```

2. Check Role bindings:
```bash
kubectl get rolebinding -n qa-agent -o yaml
```

---

## Security Notes

1. **No Public Exposure**: API is ClusterIP only - never expose directly to internet
2. **Internal Ingress**: UI ingress whitelists private IP ranges by default
3. **NetworkPolicy**: Only same-namespace pods can access the API
4. **RBAC**: API has read-only access to K8s resources (pods, services, etc.)
5. **Secrets**: Passwords are never logged; ALLOW_PROD blocks production by default

---

## Single-Chart Installation (Alternative)

If you prefer a single Helm release, use values file:

```yaml
# values-combined.yaml
# Install both API and UI with one command
```

```bash
# Not yet implemented - use separate charts for now
```
