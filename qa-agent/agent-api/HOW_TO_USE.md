# How to Use Interactive QA Buddy

## Quick Start Guide

This guide explains how to use the Interactive QA Buddy to test web applications.

## Prerequisites

1. **Python 3.8+** installed
2. **Dependencies installed**:
   ```bash
   cd qa-agent/agent-api
   pip install -r requirements.txt
   ```

3. **Playwright browsers installed**:
   ```bash
   playwright install chromium
   ```

## Step 1: Start the API Server

```bash
cd qa-agent/agent-api
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at: `http://localhost:8000`

API documentation: `http://localhost:8000/docs`

## Step 2: Start a Run

### Using curl

```bash
curl -X POST "http://localhost:8000/api/runs/start" \
  -H "Content-Type: application/json" \
  -d '{
    "base_url": "https://your-app.example.com",
    "env": "dev",
    "headless": true
  }'
```

**Response:**
```json
{
  "run_id": "abc123def456",
  "state": "WAIT_LOGIN_INPUT",
  "question": {
    "id": "login_creds",
    "type": "text",
    "text": "Please provide login credentials. Format: 'username,password' or JSON {\"username\":\"...\",\"password\":\"...\"}."
  }
}
```

### Using Python

```python
import httpx

response = httpx.post(
    "http://localhost:8000/api/runs/start",
    json={
        "base_url": "https://your-app.example.com",
        "env": "dev",
        "headless": True
    }
)
data = response.json()
run_id = data["run_id"]
print(f"Run started: {run_id}")
```

## Step 3: Check Status

```bash
curl "http://localhost:8000/api/runs/{run_id}/status"
```

**Response:**
```json
{
  "run_id": "abc123def456",
  "state": "WAIT_LOGIN_INPUT",
  "question": {
    "id": "login_creds",
    "type": "text",
    "text": "Please provide login credentials..."
  },
  "progress": 25,
  "current_url": "https://your-app.example.com"
}
```

## Step 4: Answer Questions

The system will ask questions at various stages. Answer them to proceed.

### Example 1: Login Credentials (WAIT_LOGIN_INPUT)

```bash
curl -X POST "http://localhost:8000/api/runs/{run_id}/answer" \
  -H "Content-Type: application/json" \
  -d '{
    "question_id": "login_creds",
    "answer": "myusername,mypassword"
  }'
```

**Or JSON format:**
```json
{
  "question_id": "login_creds",
  "answer": "{\"username\":\"myusername\",\"password\":\"mypassword\"}"
}
```

### Example 2: Context Selection (WAIT_CONTEXT_INPUT)

If multiple contexts (tenant/project/cell) are detected:

```bash
curl -X POST "http://localhost:8000/api/runs/{run_id}/answer" \
  -H "Content-Type: application/json" \
  -d '{
    "question_id": "context_select",
    "answer": "tenant_a"
  }'
```

**Available options** are shown in the question's `options` array.

### Example 3: Test Intent Selection (WAIT_TEST_INTENT)

After discovery completes:

```bash
curl -X POST "http://localhost:8000/api/runs/{run_id}/answer" \
  -H "Content-Type: application/json" \
  -d '{
    "question_id": "test_intent",
    "answer": "smoke"
  }'
```

**Available options:**
- `smoke` - Minimal happy-path tests
- `crud_sanity` - Create/update/delete/validation tests (safe)
- `module_based` - Module-specific tests
- `exploratory_15m` - Guided exploration (safe)

### Example 4: Confirmation (WAIT_LOGIN_CONFIRM)

For yes/no questions:

```bash
curl -X POST "http://localhost:8000/api/runs/{run_id}/answer" \
  -H "Content-Type: application/json" \
  -d '{
    "question_id": "login_confirm",
    "answer": "yes"
  }'
```

**Valid answers:** `yes`, `y`, `true`, `1` or `no`, `n`, `false`, `0`

## Step 5: Monitor Progress

Keep checking status to see progress:

```bash
# Check status
curl "http://localhost:8000/api/runs/{run_id}/status"

# Watch for state changes:
# - WAIT_LOGIN_INPUT → LOGIN_ATTEMPT → POST_LOGIN_VALIDATE
# - CONTEXT_DETECT → WAIT_CONTEXT_INPUT → DISCOVERY_RUN
# - DISCOVERY_SUMMARY → WAIT_TEST_INTENT → TEST_PLAN_BUILD
# - TEST_EXECUTE → REPORT_GENERATE → DONE
```

## Step 6: View Results

### Get HTML Report

```bash
curl "http://localhost:8000/api/runs/{run_id}/report" > report.html
```

Or open in browser:
```
http://localhost:8000/api/runs/{run_id}/report
```

### Get JSON Report

```bash
# Report is saved at:
# artifacts/{run_id}/report.json

# Also available via status endpoint when state is DONE
curl "http://localhost:8000/api/runs/{run_id}/status"
```

## Complete Workflow Example

```bash
# 1. Start run
RUN_ID=$(curl -s -X POST "http://localhost:8000/api/runs/start" \
  -H "Content-Type: application/json" \
  -d '{"base_url": "https://your-app.example.com", "env": "dev"}' \
  | jq -r '.run_id')

echo "Run ID: $RUN_ID"

# 2. Check status
curl "http://localhost:8000/api/runs/$RUN_ID/status" | jq

# 3. Answer login question
curl -X POST "http://localhost:8000/api/runs/$RUN_ID/answer" \
  -H "Content-Type: application/json" \
  -d '{"question_id": "login_creds", "answer": "user,pass"}'

# 4. Wait and check status again
sleep 5
curl "http://localhost:8000/api/runs/$RUN_ID/status" | jq

# 5. Answer context question (if asked)
curl -X POST "http://localhost:8000/api/runs/$RUN_ID/answer" \
  -H "Content-Type: application/json" \
  -d '{"question_id": "context_select", "answer": "tenant_a"}'

# 6. Wait for discovery to complete
sleep 10
curl "http://localhost:8000/api/runs/$RUN_ID/status" | jq

# 7. Answer test intent question
curl -X POST "http://localhost:8000/api/runs/$RUN_ID/answer" \
  -H "Content-Type: application/json" \
  -d '{"question_id": "test_intent", "answer": "smoke"}'

# 8. Wait for completion
sleep 30
curl "http://localhost:8000/api/runs/$RUN_ID/status" | jq

# 9. Get HTML report
curl "http://localhost:8000/api/runs/$RUN_ID/report" > report.html
echo "Report saved to report.html"
```

## Using the Test Script

For automated testing, use the provided test script:

```bash
# Mock flow (no API required)
python3 test_interactive_flow.py --mock

# Real API test
python3 test_interactive_flow.py --url https://your-app.example.com
```

## State Flow Overview

```
START
  ↓
OPEN_URL
  ↓
SESSION_CHECK
  ↓
[If login needed]
  ↓
WAIT_LOGIN_INPUT → LOGIN_ATTEMPT → POST_LOGIN_VALIDATE
  ↓
[If already logged in]
  ↓
CONTEXT_DETECT
  ↓
[If multiple contexts]
  ↓
WAIT_CONTEXT_INPUT
  ↓
DISCOVERY_RUN
  ↓
DISCOVERY_SUMMARY
  ↓
WAIT_TEST_INTENT
  ↓
TEST_PLAN_BUILD
  ↓
TEST_EXECUTE
  ↓
REPORT_GENERATE
  ↓
DONE
```

## Question Types

### 1. Text (`type: "text"`)
- **When**: Login credentials needed
- **Answer format**: `"username,password"` or JSON
- **Example**: `"admin,secret123"`

### 2. Select One (`type: "select_one"`)
- **When**: Multiple options available (context, test intent)
- **Answer format**: Option ID from `options` array
- **Example**: `"smoke"` or `"tenant_a"`

### 3. Confirm (`type: "confirm"`)
- **When**: Yes/no confirmation needed
- **Answer format**: `"yes"` or `"no"`
- **Example**: `"yes"`

## Artifacts

All artifacts are saved in: `artifacts/{run_id}/`

- `discovery.json` - Discovery results
- `discovery_summary.json` - Discovery summary
- `test_plan.json` - Generated test plan
- `report.json` - Test execution results
- `report.html` - HTML report
- Screenshots (on failures)
- Videos (if supported)
- HAR/trace files (if supported)

## Troubleshooting

### "Connection refused"
- Ensure API server is running: `uvicorn app.main:app --reload`

### "Run not found"
- Check run_id is correct
- Run may have expired (check server logs)

### "State not accepting answers"
- Check current state with `/status` endpoint
- Some states (like TEST_EXECUTE) are automated and don't accept answers

### Login fails
- Check credentials are correct
- Verify Keycloak URL is accessible
- Check browser console for errors (if not headless)

### Discovery finds no pages
- Verify you're logged in correctly
- Check navigation elements are visible
- May need to wait longer for page load

## API Endpoints Summary

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/runs/start` | POST | Start a new run |
| `/api/runs/{run_id}/status` | GET | Get run status |
| `/api/runs/{run_id}/answer` | POST | Answer a question |
| `/api/runs/{run_id}/report` | GET | Get HTML report |

## Next Steps

1. **Try the mock flow**: `python3 test_interactive_flow.py --mock`
2. **Run contract tests**: `python3 test_api_contract.py`
3. **Start with a simple URL**: Use a test application first
4. **Check the API docs**: Visit `http://localhost:8000/docs` for interactive API documentation
