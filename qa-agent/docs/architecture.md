# QA Agent Architecture

## Overview

The QA Agent is a Kubernetes-deployable system designed for automated QA testing of cloud products. It performs UI and API testing within a specified namespace, mimicking manual QA workflows while maintaining strict security boundaries.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Kubernetes Namespace                            │
│                                                                              │
│  ┌──────────────────┐     ┌─────────────────┐     ┌──────────────────────┐  │
│  │                  │     │                 │     │                      │  │
│  │   Agent API      │────▶│  Runner Jobs    │────▶│  Target Services     │  │
│  │   (FastAPI)      │     │  (Playwright)   │     │  (CMP UI/API)        │  │
│  │                  │     │                 │     │                      │  │
│  └────────┬─────────┘     └────────┬────────┘     └──────────────────────┘  │
│           │                        │                                         │
│           ▼                        ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         PVC (Artifacts)                               │   │
│  │  screenshots/ │ videos/ │ reports/ │ har/                            │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─────────────────┐     ┌─────────────────┐     ┌──────────────────────┐  │
│  │   ConfigMap     │     │    Secrets      │     │   Service Catalog    │  │
│  │   (Config)      │     │  (Credentials)  │     │   (Discovery)        │  │
│  └─────────────────┘     └─────────────────┘     └──────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Agent API (FastAPI)

The central orchestration service that:

- **Run Management**: Creates, monitors, and tracks test runs
- **Service Discovery**: Auto-discovers services, ingresses, and endpoints in the namespace
- **Flow Loading**: Loads and validates YAML flow definitions
- **Artifact Management**: Stores and serves test artifacts
- **Rate Limiting**: Controls concurrent test execution

**Key Endpoints:**
- `POST /runs` - Start a new test run
- `GET /runs/{run_id}` - Get run status and summary
- `GET /runs/{run_id}/artifacts` - List/download artifacts
- `GET /catalog` - Get discovered services
- `POST /catalog/discover` - Trigger discovery refresh

### 2. Runner (Playwright)

Node.js-based test executor that:

- **UI Testing**: Performs browser automation using Playwright
- **API Testing**: Executes API calls with authentication
- **K8s Checks**: Validates Kubernetes resources (pod ready, service available)
- **Artifact Capture**: Screenshots, videos, HAR logs

**Execution Model:**
- Runs as Kubernetes Jobs (one per test run)
- Isolated environment per run
- Automatic cleanup after completion

### 3. API Runner (Python)

Python module for API testing with:

- **Token Handling**: Bearer token authentication
- **Retries**: Configurable retry logic
- **Assertions**: JSONPath-based response validation
- **Secret Redaction**: Automatic log sanitization

### 4. Flow Definitions (YAML)

Declarative test flows supporting:

- **UI Steps**: navigate, click, fill, assert, screenshot
- **API Steps**: HTTP calls with assertions and extraction
- **K8s Steps**: Pod/service health checks, log grep
- **Variables**: Dynamic interpolation

## Data Flow

```
1. User submits run request
   │
   ▼
2. Agent API validates request
   ├── Check security guards (ENV_GUARD, TEST_ACCOUNT_GUARD)
   ├── Load flow definition
   ├── Check rate limits
   └── Validate variables
   │
   ▼
3. Agent API creates runner job
   ├── Generate unique run_id
   ├── Create artifact directory
   └── Launch K8s Job with runner image
   │
   ▼
4. Runner executes flow
   ├── Setup steps
   ├── Main test steps
   │   ├── UI automation (Playwright)
   │   ├── API calls (axios/requests)
   │   └── K8s checks (kubectl)
   └── Teardown steps
   │
   ▼
5. Artifacts saved to PVC
   ├── screenshots/
   ├── videos/
   ├── reports/report.json
   └── network.har
   │
   ▼
6. Agent API updates run status
   └── User retrieves results
```

## Security Architecture

### Network Isolation

```
┌────────────────────────────────────────────┐
│             NetworkPolicy                   │
│                                            │
│  Ingress:  Only from same namespace        │
│  Egress:   DNS + K8s API + Target URLs     │
│                                            │
│  ╔════════════════════════════════════╗    │
│  ║  QA Agent Components               ║    │
│  ║                                    ║    │
│  ║  ┌─────────┐    ┌─────────────┐   ║    │
│  ║  │  API    │◀──▶│   Runner    │   ║    │
│  ║  └────┬────┘    └──────┬──────┘   ║    │
│  ║       │                │          ║    │
│  ╚═══════│════════════════│══════════╝    │
│          │                │               │
│          ▼                ▼               │
│    ┌───────────────────────────────┐      │
│    │     Target Services (CMP)     │      │
│    └───────────────────────────────┘      │
└────────────────────────────────────────────┘
```

### RBAC Model

| Component | Permissions |
|-----------|-------------|
| Agent API | get/list/watch: services, endpoints, configmaps, ingresses, pods<br>create/delete: jobs |
| Runner | get/list: services, endpoints, pods<br>get: pods/log (optional) |

### Security Guards

1. **ENV_GUARD**: Blocks production execution unless flow is in allowlist
2. **TEST_ACCOUNT_GUARD**: Requires `testTenant=true` variable
3. **Secret Redaction**: All logs sanitize sensitive data

## Scalability

### Horizontal Scaling

- Agent API: Single replica (stateful run tracking)
- Runners: Naturally horizontal (one job per run)
- Rate limiting controls concurrency

### Resource Limits

| Component | CPU | Memory |
|-----------|-----|--------|
| Agent API | 500m | 512Mi |
| Runner | 1000m | 2Gi |

### Artifact Retention

- Configurable retention period (default: 7 days)
- Automatic cleanup of old artifacts
- PVC size scales with test volume

## Integration Points

### Target Services

The QA Agent integrates with:

1. **CMP UI**: Browser automation via Playwright
2. **CMP API**: REST API calls with Bearer auth
3. **TCPWave IPAM**: Placeholder endpoints for IP verification
4. **NAT Services**: Placeholder endpoints for NAT state

### Kubernetes API

Uses K8s API for:

- Service discovery (watch services/endpoints)
- Runner job management (create/monitor/cleanup)
- Health checks (pod ready, service available)

## Monitoring

### Health Endpoints

- `/health/live` - Liveness probe
- `/health/ready` - Readiness probe
- `/health/config` - Configuration dump

### Metrics (Recommended)

- `qa_agent_runs_total{flow, status}`
- `qa_agent_run_duration_seconds{flow}`
- `qa_agent_step_duration_seconds{flow, step_type}`
- `qa_agent_active_runs`

### Logging

- Structured JSON logging
- Automatic secret redaction
- Request/response tracing

## Deployment Topology

```
┌──────────────────────────────────────────────────┐
│                 Kubernetes Cluster               │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │            qa-agent namespace              │  │
│  │                                            │  │
│  │   Deployment: qa-agent-api (1 replica)     │  │
│  │   Service: qa-agent-api (ClusterIP)        │  │
│  │   PVC: qa-agent-artifacts (10Gi)           │  │
│  │   ConfigMap: qa-agent-config               │  │
│  │   Secret: qa-agent-secrets                 │  │
│  │   ServiceAccount: qa-agent                 │  │
│  │   ServiceAccount: qa-agent-runner          │  │
│  │   Role/RoleBinding: qa-agent-api           │  │
│  │   Role/RoleBinding: qa-agent-runner        │  │
│  │   NetworkPolicy: qa-agent                  │  │
│  │                                            │  │
│  │   Jobs: qa-runner-{run_id} (on-demand)     │  │
│  │                                            │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
└──────────────────────────────────────────────────┘
```
