# QA Agent

A Kubernetes-deployable QA Agent for automated UI and API testing of cloud products.

## Overview

The QA Agent performs manual-QA-like testing via UI and API automation, running entirely within a specified Kubernetes namespace. It supports:

- **Auto-discovery** of services, ingresses, and endpoints
- **UI testing** via Playwright browser automation
- **API testing** with authentication, retries, and assertions
- **K8s health checks** (pod ready, service available, log grep)
- **Artifact capture** (screenshots, videos, HAR logs, JSON reports)
- **Security guards** to prevent production accidents

## Quick Start

### Prerequisites

- Kubernetes cluster (1.24+)
- Helm 3.x
- Docker for building images

### Installation

```bash
# 1. Build images
make docker-build

# 2. Push to registry (configure REGISTRY)
REGISTRY=your-registry.com/qa-agent make docker-push

# 3. Install via Helm
helm install qa-agent charts/qa-agent \
  --namespace qa-agent \
  --create-namespace \
  --set config.uiBaseUrl=https://your-cmp.example.com \
  --set config.apiBaseUrl=https://your-api.example.com \
  --set secrets.uiUsername=qa-test-user \
  --set secrets.uiPassword=test-password \
  --set secrets.apiToken=your-api-token

# 4. Verify installation
kubectl get pods -n qa-agent
```

### Run a Test

```bash
# Port-forward the API
kubectl port-forward svc/qa-agent-api 8080:8080 -n qa-agent

# Execute a flow
curl -X POST http://localhost:8080/runs \
  -H "Content-Type: application/json" \
  -d '{
    "flow_name": "health-check",
    "env": "staging",
    "variables": {
      "testTenant": true
    }
  }'

# Check status
curl http://localhost:8080/runs/{run_id}

# Get artifacts
curl http://localhost:8080/artifacts/{run_id}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Kubernetes Namespace                     │
│                                                              │
│  ┌───────────────┐     ┌─────────────────┐                  │
│  │  Agent API    │────▶│  Runner Jobs    │                  │
│  │  (FastAPI)    │     │  (Playwright)   │                  │
│  └───────┬───────┘     └────────┬────────┘                  │
│          │                      │                            │
│          ▼                      ▼                            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                  PVC (Artifacts)                     │    │
│  │  screenshots/ │ videos/ │ reports/ │ har/           │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/runs` | Start a new test run |
| GET | `/runs/{run_id}` | Get run status and summary |
| GET | `/runs/{run_id}/status` | Get brief status (for polling) |
| POST | `/runs/{run_id}/cancel` | Cancel a running test |
| GET | `/artifacts/{run_id}` | List artifacts with download links |
| GET | `/artifacts/{run_id}/download/{path}` | Download specific artifact |
| GET | `/catalog` | Get discovered service catalog |
| POST | `/catalog/discover` | Trigger discovery refresh |
| GET | `/health` | Health check |

## Flow Definition

Flows are defined in YAML:

```yaml
name: my-test-flow
description: "Example test flow"
version: "1.0.0"

allowed_environments:
  - dev
  - staging

required_variables:
  - testTenant

steps:
  - name: "Navigate to app"
    type: ui
    ui:
      action: navigate
      url: "${UI_BASE_URL}"
      screenshot: true

  - name: "Check API health"
    type: api
    api:
      method: GET
      url: "${API_BASE_URL}/health"
      expected_status: 200
      assertions:
        - type: equals
          target: "$.status"
          expected: "healthy"

  - name: "Verify service ready"
    type: k8s
    k8s:
      check_type: service_available
      resource_name: "my-service"
```

## Security Features

### Guards

- **ENV_GUARD**: Blocks production execution unless explicitly allowed
- **TEST_ACCOUNT_GUARD**: Requires `testTenant: true` variable

### Network Isolation

- ClusterIP service only (no external exposure)
- NetworkPolicy restricts traffic to namespace

### Secret Protection

- Credentials stored in Kubernetes Secrets
- Automatic log redaction of sensitive data
- Never logs passwords, tokens, or API keys

## Project Structure

```
qa-agent/
├── agent-api/          # FastAPI orchestration service
│   ├── app/
│   │   ├── main.py
│   │   ├── routers/    # API endpoints
│   │   ├── services/   # Business logic
│   │   ├── models/     # Pydantic models
│   │   └── utils/      # Utilities (logging, guards)
│   ├── Dockerfile
│   └── requirements.txt
│
├── runner/             # Playwright test runner
│   ├── src/
│   │   ├── index.js
│   │   ├── runner.js
│   │   └── executors/  # UI, API, K8s executors
│   ├── Dockerfile
│   └── package.json
│
├── api-runner/         # Python API test module
│   └── app/
│       └── runner.py
│
├── flows/              # Flow definitions
│   └── samples/
│       ├── public-ip-allocation.yaml
│       └── health-check.yaml
│
├── charts/qa-agent/    # Helm chart
│   ├── Chart.yaml
│   ├── values.yaml
│   └── templates/
│
├── docs/               # Documentation
│   ├── architecture.md
│   ├── setup.md
│   ├── security.md
│   └── flows/
│
├── Makefile
└── README.md
```

## Configuration

See `charts/qa-agent/values.yaml` for all configuration options.

Key settings:

| Setting | Description | Default |
|---------|-------------|---------|
| `config.uiBaseUrl` | CMP UI URL | Required |
| `config.apiBaseUrl` | CMP API URL | Required |
| `config.maxConcurrentRuns` | Max parallel runs | `5` |
| `config.envGuardEnabled` | Block production | `true` |
| `secrets.uiUsername` | Test account username | Required |
| `secrets.uiPassword` | Test account password | Required |
| `secrets.apiToken` | API bearer token | Required |

## Development

```bash
# Run API locally
make dev-api

# Run tests
make test

# Lint code
make lint

# Build Docker images
make docker-build
```

## Documentation

- [Architecture](docs/architecture.md)
- [Setup Guide](docs/setup.md)
- [Security Guide](docs/security.md)
- [Public IP Flow](docs/flows/public-ip-allocation.md)

## License

MIT License - See LICENSE file for details.
