# UI Usage Examples

## Quick Start

1. **Start the server:**
   ```bash
   cd qa-agent/agent-api
   uvicorn app.main:app --reload
   ```

2. **Open the UI:**
   ```
   http://localhost:8000/ui/
   ```

3. **Fill in the form and click "Start Run"**

## curl Examples (for comparison)

### Start a Run
```bash
curl -X POST "http://localhost:8000/runs/start" \
  -H "Content-Type: application/json" \
  -d '{
    "base_url": "https://your-app.example.com",
    "env": "dev",
    "headless": true,
    "auth": {
      "type": "keycloak",
      "username": "testuser",
      "password": "testpass"
    }
  }'
```

### Check Status
```bash
curl "http://localhost:8000/runs/{run_id}/status"
```

### Answer Question
```bash
# For select_one
curl -X POST "http://localhost:8000/runs/{run_id}/answer" \
  -H "Content-Type: application/json" \
  -d '{
    "question_id": "test_intent",
    "answer": "smoke"
  }'

# For confirm
curl -X POST "http://localhost:8000/runs/{run_id}/answer" \
  -H "Content-Type: application/json" \
  -d '{
    "question_id": "login_confirm",
    "answer": "yes"
  }'

# For text
curl -X POST "http://localhost:8000/runs/{run_id}/answer" \
  -H "Content-Type: application/json" \
  -d '{
    "question_id": "login_creds",
    "answer": "username,password"
  }'
```

### Get Report
```bash
curl "http://localhost:8000/runs/{run_id}/report" > report.html
```

## UI vs curl

The UI automates all these curl commands:
- ✅ Automatically polls status every 2 seconds
- ✅ Detects questions and shows appropriate input controls
- ✅ Handles all question types (select_one, confirm, text)
- ✅ Displays screenshots automatically
- ✅ Shows progress bar and current state
- ✅ Opens report when ready

## Configuration

The UI uses the same origin as the API by default. If you need to use a different API host, edit `ui/index.html`:

```javascript
// Change this line:
const API_BASE = window.location.origin;

// To:
const API_BASE = 'http://your-api-host:8000';
```

## Screenshots

Screenshots are automatically displayed when:
- A question includes a `screenshot_path` field
- The screenshot is accessible via relative path from artifacts directory

If screenshots don't load, check:
1. Screenshot path in question object
2. Artifacts directory permissions
3. Browser console for 404 errors
