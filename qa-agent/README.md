# QA Agent - Autonomous QA Testing Platform

Intelligent QA testing platform that automatically discovers, tests, and reports on web applications. Features a simplified 5-step workflow (QA Buddy V2) for autonomous testing.

## Overview

The QA Agent performs human-like QA testing via browser automation and API testing. It supports:

- **QA Buddy V2** - Simplified 5-step autonomous testing flow
- **Auto-discovery** of pages, forms, APIs, and user permissions
- **UI testing** via Playwright browser automation
- **API testing** with authentication and assertions
- **Health checks** by systematically visiting all pages
- **Keycloak authentication** support with automatic redirect handling
- **Artifact capture** (screenshots, videos, HAR logs, HTML reports)
- **Security guards** to prevent production accidents

## Quick Start

### Prerequisites

- Python 3.8+
- Playwright (`playwright install chromium`)
- Node.js 18+ (for UI)

### Local Development

```bash
# 1. Start API server
cd agent-api
pip install -r requirements.txt
playwright install chromium
mkdir -p data
DATA_DIR=./data ALLOW_PROD=false uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload

# 2. Start UI (in another terminal)
cd ui
npm install
npm run dev

# 3. Access
# API: http://localhost:8080
# UI: http://localhost:3000
# API Docs: http://localhost:8080/docs
```

## QA Buddy V2 - 5-Step Flow

QA Buddy V2 follows a simple, linear workflow:

```
S1: Login Flow
  ↓
S2: Trace all pages to know all Paths
  ↓
S3: Should know access to perform action
  ↓
S4: Check health of app. by clicking all pages
  ↓
S5: Now everything fine, ask to test what
```

### API Usage

#### Start Discovery

```bash
curl -X POST http://localhost:8080/qa-buddy-v2/discover \
  -H "Content-Type: application/json" \
  -d '{
    "application_url": "https://your-app.com",
    "username": "your-username",
    "password": "your-password",
    "env": "staging",
    "config_name": "keycloak"
  }'
```

**Response:**
```json
{
  "discovery_id": "abc123",
  "status": "running",
  "current_stage": "S1",
  "message": "Discovery started..."
}
```

#### Check Status

```bash
curl http://localhost:8080/qa-buddy-v2/discover/{discovery_id}
```

**Response includes:**
- `s1_login` - Login flow results
- `s2_pages` - Discovered pages and paths
- `s3_access` - User permissions and accessible actions
- `s4_health` - Health check results for all pages
- `s5_tests` - Test execution results (if test_prompt provided)

#### Execute Tests (S5)

After S1-S4 complete, you can run specific tests:

```bash
curl -X POST http://localhost:8080/qa-buddy-v2/discover/{discovery_id}/test \
  -H "Content-Type: application/json" \
  -d '{
    "test_prompt": "test all forms",
    "test_type": "form_validation"
  }'
```

**Supported test prompts:**
- `"test all forms"` - Validates all form pages
- `"test navigation"` - Tests link clicking and navigation
- `"test tables"` - Checks table rendering and data loading
- `"test login"` - Validates login flow

#### Stream Progress (SSE)

```bash
curl -X POST http://localhost:8080/qa-buddy-v2/discover/stream \
  -H "Content-Type: application/json" \
  -d '{
    "application_url": "https://your-app.com",
    "username": "user",
    "password": "pass",
    "env": "staging"
  }'
```

## Keycloak Authentication

QA Buddy V2 automatically handles Keycloak authentication flows:

1. Navigate to application URL → automatically redirects to Keycloak
2. Fill credentials on Keycloak login page
3. Submit and wait for redirect back to application
4. Verify login success and continue discovery

**Important:** Use your **application URL** (not the Keycloak URL). The system handles redirects automatically.

See [KEYCLOAK_FLOW.md](KEYCLOAK_FLOW.md) for detailed documentation.

## Legacy Endpoints

The following endpoints are still available for backward compatibility:

- `POST /discover` - Basic discovery
- `POST /generate-tests` - Generate smoke tests
- `POST /run` - Execute tests
- `POST /qa-buddy/discover` - Original QA Buddy (complex flow)

**Recommendation:** Use `/qa-buddy-v2/discover` for new projects.

## API Endpoints

### QA Buddy V2 (Recommended)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/qa-buddy-v2/discover` | Start 5-step discovery flow |
| POST | `/qa-buddy-v2/discover/stream` | Start with SSE streaming |
| GET | `/qa-buddy-v2/discover/{id}` | Get discovery status/results |
| POST | `/qa-buddy-v2/discover/{id}/test` | Execute test prompt (S5) |

### Legacy Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/discover` | Basic discovery |
| GET | `/discover/{id}` | Get discovery results |
| POST | `/generate-tests` | Generate smoke tests |
| POST | `/run` | Execute tests |
| GET | `/run/{id}` | Get run status |
| GET | `/run/{id}/report.html` | Get HTML report |
| GET | `/health` | Health check |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    QA Agent Platform                        │
│                                                              │
│  ┌───────────────┐     ┌─────────────────┐                  │
│  │  FastAPI      │────▶│  Playwright      │                  │
│  │  (API)        │     │  (Browser)       │                  │
│  └───────┬───────┘     └────────┬────────┘                  │
│          │                      │                            │
│          ▼                      ▼                            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Data Directory (Artifacts)              │    │
│  │  discovery.json │ screenshots/ │ reports/ │ har/   │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Security Features

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

## Project Structure

```
qa-agent/
├── agent-api/              # FastAPI service
│   ├── app/
│   │   ├── main.py        # FastAPI app
│   │   ├── routers/        # API endpoints
│   │   │   ├── qa_buddy_v2.py  # QA Buddy V2 (recommended)
│   │   │   ├── qa_buddy.py     # Original QA Buddy
│   │   │   └── ...
│   │   ├── services/       # Business logic
│   │   └── utils/          # Utilities
│   ├── data/               # Discovery/run artifacts
│   └── requirements.txt
│
├── ui/                     # Next.js frontend
│   ├── app/
│   │   ├── page.tsx        # Dashboard
│   │   ├── reports/        # Reports page
│   │   └── api/            # API proxies
│   └── package.json
│
├── flows/                  # Flow definitions (YAML)
│   └── samples/
│
├── docs/                   # Documentation
│   ├── architecture.md
│   └── setup.md
│
├── KEYCLOAK_FLOW.md        # Keycloak authentication guide
├── POSTMAN_COLLECTION.md   # Postman API collection
└── README.md               # This file
```

## Development

```bash
# Run API locally
cd agent-api
DATA_DIR=./data uvicorn app.main:app --reload

# Run UI locally
cd ui
npm run dev

# Run tests
cd agent-api
pytest tests/

# Lint
flake8 app/
```

## Documentation

- [QA Buddy V2 API](agent-api/README.md) - API documentation
- [Keycloak Flow](KEYCLOAK_FLOW.md) - Keycloak authentication guide
- [Postman Collection](POSTMAN_COLLECTION.md) - API examples
- [Architecture](docs/architecture.md) - System architecture
- [Setup Guide](docs/setup.md) - Detailed setup instructions

## Example Workflow

1. **Start Discovery:**
   ```bash
   POST /qa-buddy-v2/discover
   {
     "application_url": "https://app.example.com",
     "username": "test-user",
     "password": "test-pass",
     "env": "staging"
   }
   ```

2. **Monitor Progress:**
   ```bash
   GET /qa-buddy-v2/discover/{discovery_id}
   # Check current_stage: S1, S2, S3, S4, or S5
   ```

3. **Execute Tests:**
   ```bash
   POST /qa-buddy-v2/discover/{discovery_id}/test
   {
     "test_prompt": "test all forms and navigation"
   }
   ```

4. **View Results:**
   - Check `s4_health` for health status
   - Check `s5_tests` for test results
   - Download screenshots from `data/{discovery_id}/`

## License

MIT License
