# QA Agent API

Intelligent Test Discovery and Execution Service using Playwright.

## Quick Start

```bash
# Install
pip install -r requirements.txt
playwright install chromium

# Create data directory
mkdir -p data

# Run
DATA_DIR=./data ALLOW_PROD=false uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
```

## QA Buddy V2 (Recommended)

QA Buddy V2 provides a simplified 5-step autonomous testing flow:

1. **S1: Login Flow** - Authenticate with Keycloak or other providers
2. **S2: Trace All Pages** - Discover all navigation paths
3. **S3: Detect Access** - Map user permissions and capabilities
4. **S4: Health Check** - Systematically verify all pages
5. **S5: Test Execution** - Run tests based on natural language prompts

### Endpoints

```bash
# Start discovery
POST /qa-buddy-v2/discover
{
  "application_url": "https://your-app.com",
  "username": "user",
  "password": "pass",
  "env": "staging",
  "config_name": "keycloak"
}

# Check status
GET /qa-buddy-v2/discover/{discovery_id}

# Execute tests (after S1-S4 complete)
POST /qa-buddy-v2/discover/{discovery_id}/test
{
  "test_prompt": "test all forms"
}

# Stream progress (SSE)
POST /qa-buddy-v2/discover/stream
```

### Response Structure

```json
{
  "discovery_id": "abc123",
  "status": "completed",
  "current_stage": "S5",
  "s1_login": {
    "status": "success",
    "session_valid": true
  },
  "s2_pages": {
    "pages": [...],
    "total_paths": 25
  },
  "s3_access": {
    "user_permissions": {...},
    "total_actions": 45
  },
  "s4_health": {
    "health_status": "healthy",
    "page_health": [...]
  },
  "s5_tests": {
    "test_results": [...],
    "summary": {...}
  }
}
```

## Legacy Endpoints

### Discovery

```bash
# Start discovery (crawls app, finds pages/forms/APIs)
POST /discover
{
  "ui_url": "https://your-app.com",
  "username": "admin",
  "password": "password123",
  "env": "staging"
}
# Returns: { "discovery_id": "abc123..." }

# Get discovery results
GET /discover/{discovery_id}
# Returns: discovery.json with pages, forms, api_endpoints
```

### Test Generation

```bash
# Generate smoke tests from discovery
POST /generate-tests
{
  "discovery_id": "abc123..."
}
# Returns: preview + counts

# Get all generated tests
GET /tests/{discovery_id}
```

### Test Execution

```bash
# Run tests (rate limited: 1 concurrent)
POST /run
{
  "discovery_id": "abc123...",
  "suite": "smoke"
}
# Returns: { "run_id": "xyz789..." }

# Get run status and report
GET /run/{run_id}

# Get HTML report
GET /run/{run_id}/report.html

# List artifacts (screenshots, etc.)
GET /run/{run_id}/artifacts
# Returns: list with download_url for each file

# Download artifact
GET /artifacts/{run_id}/{filename}
```

### Utility

```bash
# Health check
GET /health

# List all runs
GET /run/runs

# Safety config
GET /safety
```

## Safety Features

| Feature | Description |
|---------|-------------|
| **Production Block** | URLs/env containing `prod`, `production`, `live` are blocked |
| **ALLOW_PROD=true** | Set env var to enable production testing |
| **Secret Redaction** | Passwords never logged or stored in reports |
| **Rate Limiting** | Max 1 concurrent test run |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_DIR` | `/data` | Where to store discovery/run data |
| `ALLOW_PROD` | `false` | Enable production environment testing |

## Output Structure

```
/data/
├── {discovery_id}/
│   ├── discovery.json      # Discovery results
│   ├── s1_before_login.png # Login screenshots
│   ├── s2_page_*.png       # Page screenshots
│   ├── s4_health_*.png      # Health check screenshots
│   └── test_*.json         # Test results
│
└── {run_id}/
    ├── report.json         # Test results
    ├── report.html         # HTML report
    └── test_*.png          # Test screenshots
```

## Docker

```bash
# Build
docker build -t qa-agent-api .

# Run
docker run -p 8080:8080 -v $(pwd)/data:/data qa-agent-api
```

## Keycloak Authentication

QA Buddy V2 automatically handles Keycloak redirect flows:

1. Navigate to application URL
2. Detect redirect to Keycloak
3. Fill credentials and submit
4. Wait for redirect back to application
5. Verify login success

Use your **application URL** (not Keycloak URL). The system handles redirects automatically.

## API Documentation

Interactive API documentation available at:
- Swagger UI: `http://localhost:8080/docs`
- ReDoc: `http://localhost:8080/redoc`
