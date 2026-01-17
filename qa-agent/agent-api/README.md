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
DATA_DIR=./data uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
```

## API Endpoints

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
GET /runs

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
│   ├── smoke_tests.json    # Generated tests
│   ├── 01_initial.png      # Login page screenshot
│   ├── 02_after_login.png  # After login screenshot
│   └── page_*.png          # Page screenshots
│
└── {run_id}/
    ├── report.json         # Test results
    └── test_*.png          # Test screenshots
```

## Docker

```bash
# Build
docker build -t qa-agent-api .

# Run
docker run -p 8080:8080 -v $(pwd)/data:/data qa-agent-api
```
