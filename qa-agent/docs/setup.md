# QA Agent Setup Guide

## Prerequisites

- Kubernetes cluster (1.24+)
- Helm 3.x
- kubectl configured for your cluster
- Container registry for images

## Quick Start

### 1. Build Docker Images

```bash
# Build Agent API image
cd qa-agent/agent-api
docker build -t qa-agent-api:latest .

# Build Runner image
cd ../runner
docker build -t qa-agent-runner:latest .

# Push to your registry
docker tag qa-agent-api:latest your-registry/qa-agent-api:latest
docker tag qa-agent-runner:latest your-registry/qa-agent-runner:latest
docker push your-registry/qa-agent-api:latest
docker push your-registry/qa-agent-runner:latest
```

### 2. Create Namespace

```bash
kubectl create namespace qa-agent
```

### 3. Configure Values

Create a `values-custom.yaml` file:

```yaml
global:
  environment: staging
  namespace: qa-agent

# Update image references to your registry
agentApi:
  image:
    repository: your-registry/qa-agent-api
    tag: latest

runner:
  image:
    repository: your-registry/qa-agent-runner
    tag: latest

# REQUIRED: Configure target URLs
config:
  uiBaseUrl: "https://your-cmp-ui.example.com"
  apiBaseUrl: "https://your-cmp-api.example.com"

# REQUIRED: Configure test credentials
secrets:
  create: true
  # Use test account credentials ONLY
  uiUsername: "qa-test-user@example.com"
  uiPassword: "test-password-here"
  apiToken: "your-api-token-here"
```

### 4. Install Helm Chart

```bash
cd qa-agent/charts/qa-agent

# Validate the chart
helm lint .

# Dry run to preview
helm install qa-agent . \
  --namespace qa-agent \
  --values values-custom.yaml \
  --dry-run

# Install
helm install qa-agent . \
  --namespace qa-agent \
  --values values-custom.yaml
```

### 5. Verify Installation

```bash
# Check pods
kubectl get pods -n qa-agent

# Check service
kubectl get svc -n qa-agent

# Check logs
kubectl logs -f deployment/qa-agent-api -n qa-agent

# Test health endpoint
kubectl port-forward svc/qa-agent-api 8080:8080 -n qa-agent
curl http://localhost:8080/health
```

## Configuration Reference

### Global Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.environment` | Environment name | `staging` |
| `global.namespace` | Target namespace | `qa-agent` |

### Agent API Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `agentApi.image.repository` | Image repository | `qa-agent-api` |
| `agentApi.image.tag` | Image tag | `latest` |
| `agentApi.replicaCount` | Number of replicas | `1` |
| `agentApi.service.type` | Service type | `ClusterIP` |
| `agentApi.service.port` | Service port | `8080` |
| `agentApi.resources.limits.cpu` | CPU limit | `500m` |
| `agentApi.resources.limits.memory` | Memory limit | `512Mi` |

### Runner Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `runner.image.repository` | Image repository | `qa-agent-runner` |
| `runner.image.tag` | Image tag | `latest` |
| `runner.timeout` | Job timeout (seconds) | `600` |
| `runner.resources.limits.cpu` | CPU limit | `1` |
| `runner.resources.limits.memory` | Memory limit | `2Gi` |

### Configuration Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `config.uiBaseUrl` | CMP UI base URL | (required) |
| `config.apiBaseUrl` | CMP API base URL | (required) |
| `config.maxConcurrentRuns` | Max concurrent runs | `5` |
| `config.maxRunsPerFlow` | Max runs per flow | `1` |
| `config.envGuardEnabled` | Enable env guard | `true` |
| `config.testAccountGuardEnabled` | Enable test account guard | `true` |
| `config.logLevel` | Log level | `INFO` |

### Secret Settings

| Parameter | Description | Default |
|-----------|-------------|---------|
| `secrets.create` | Create secrets | `true` |
| `secrets.name` | Secret name | `qa-agent-secrets` |
| `secrets.uiUsername` | UI test username | (required) |
| `secrets.uiPassword` | UI test password | (required) |
| `secrets.apiToken` | API bearer token | (required) |

### Artifact Storage

| Parameter | Description | Default |
|-----------|-------------|---------|
| `artifacts.enabled` | Enable PVC | `true` |
| `artifacts.storageClass` | Storage class | (default) |
| `artifacts.size` | PVC size | `10Gi` |
| `artifacts.retentionDays` | Retention period | `7` |

## Adding Custom Flows

### 1. Create Flow Definition

Create a YAML file in `flows/samples/`:

```yaml
name: my-custom-flow
description: "My custom test flow"
version: "1.0.0"

allowed_environments:
  - dev
  - staging

required_variables:
  - testTenant

default_variables:
  testTenant: true

steps:
  - name: "Navigate to home"
    type: ui
    ui:
      action: navigate
      url: "${UI_BASE_URL}"
      screenshot: true
```

### 2. Add to ConfigMap

Option A: Include in Helm chart
```yaml
# In values-custom.yaml
extraVolumes:
  - name: custom-flows
    configMap:
      name: qa-agent-custom-flows

extraVolumeMounts:
  - name: custom-flows
    mountPath: /app/flows/custom
```

Option B: Create separate ConfigMap
```bash
kubectl create configmap qa-agent-custom-flows \
  --from-file=my-flow.yaml=flows/samples/my-flow.yaml \
  -n qa-agent
```

### 3. Reload Flows

```bash
curl -X POST http://localhost:8080/runs/flows/reload
```

## Upgrading

```bash
# Update values
vim values-custom.yaml

# Upgrade release
helm upgrade qa-agent . \
  --namespace qa-agent \
  --values values-custom.yaml
```

## Uninstalling

```bash
# Delete Helm release
helm uninstall qa-agent --namespace qa-agent

# Delete PVC (if not needed)
kubectl delete pvc qa-agent-artifacts -n qa-agent

# Delete namespace
kubectl delete namespace qa-agent
```

## Troubleshooting

### Pod Not Starting

```bash
# Check events
kubectl describe pod -l app.kubernetes.io/name=qa-agent -n qa-agent

# Check logs
kubectl logs -f deployment/qa-agent-api -n qa-agent
```

### Runner Jobs Failing

```bash
# List runner jobs
kubectl get jobs -n qa-agent

# Check job logs
kubectl logs job/qa-runner-<run_id> -n qa-agent

# Describe job
kubectl describe job/qa-runner-<run_id> -n qa-agent
```

### Discovery Not Working

```bash
# Check RBAC
kubectl auth can-i list services --as=system:serviceaccount:qa-agent:qa-agent -n qa-agent

# Manual discovery trigger
curl -X POST http://localhost:8080/catalog/discover
```

### Network Issues

```bash
# Check NetworkPolicy
kubectl get networkpolicy -n qa-agent -o yaml

# Test connectivity
kubectl run test --rm -it --image=busybox -n qa-agent -- wget -O- http://qa-agent-api:8080/health
```
