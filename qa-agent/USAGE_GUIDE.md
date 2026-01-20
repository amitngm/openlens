# QA Agent - Usage Guide

## Quick Start

### 1. Start Services

```bash
# Terminal 1: Start API
cd agent-api
DATA_DIR=./data uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload

# Terminal 2: Start UI
cd ui
npm run dev
```

### 2. Access the UI

Open your browser:
- **UI**: http://localhost:3000
- **API**: http://localhost:8080
- **API Docs**: http://localhost:8080/docs

---

## QA Buddy V2 - Complete Workflow

QA Buddy V2 follows a simple 5-step flow:

1. **S1: Login Flow** - Authenticate with Keycloak
2. **S2: Trace All Pages** - Discover all navigation paths
3. **S3: Detect Access** - Map user permissions
4. **S4: Health Check** - Verify all pages
5. **S5: Test Execution** - Run tests based on prompts

### Using the API

#### Step 1: Start Discovery

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
  "current_stage": "S1"
}
```

#### Step 2: Monitor Progress

```bash
# Check status
curl http://localhost:8080/qa-buddy-v2/discover/abc123
```

**Response shows:**
- `current_stage`: S1, S2, S3, S4, or S5
- `s1_login`: Login results
- `s2_pages`: Discovered pages
- `s3_access`: User permissions
- `s4_health`: Health check results

#### Step 3: Execute Tests (S5)

After S1-S4 complete:

```bash
curl -X POST http://localhost:8080/qa-buddy-v2/discover/abc123/test \
  -H "Content-Type: application/json" \
  -d '{
    "test_prompt": "test all forms"
  }'
```

**Supported test prompts:**
- `"test all forms"` - Validates all form pages
- `"test navigation"` - Tests link clicking
- `"test tables"` - Checks table rendering
- `"test login"` - Validates login flow

### Using the UI

1. **Navigate to Dashboard**: http://localhost:3000
2. **Start Discovery**: Use the QA Buddy section (if available)
3. **View Reports**: http://localhost:3000/reports
4. **Check API Docs**: http://localhost:8080/docs

---

## Keycloak Authentication

### Important Notes

1. **Use Application URL**: Always use your **application URL** (not the Keycloak URL)
   - ✅ Correct: `https://your-app.com`
   - ❌ Wrong: `https://keycloak.example.com/auth/...`

2. **Automatic Redirect**: The system automatically:
   - Navigates to your app
   - Follows redirect to Keycloak
   - Fills credentials
   - Waits for redirect back
   - Continues discovery

3. **Login Flow**:
   ```
   Application URL → Keycloak Login → Enter Credentials → 
   Submit → Redirect Back → Continue Discovery
   ```

See [KEYCLOAK_FLOW.md](KEYCLOAK_FLOW.md) for detailed documentation.

---

## Example Workflow

### Complete Example

```bash
# 1. Start discovery
DISCOVERY_ID=$(curl -s -X POST http://localhost:8080/qa-buddy-v2/discover \
  -H "Content-Type: application/json" \
  -d '{
    "application_url": "https://app.example.com",
    "username": "test-user",
    "password": "test-pass",
    "env": "staging"
  }' | jq -r '.discovery_id')

echo "Discovery ID: $DISCOVERY_ID"

# 2. Wait and check status (poll every 10 seconds)
while true; do
  STATUS=$(curl -s http://localhost:8080/qa-buddy-v2/discover/$DISCOVERY_ID | jq -r '.status')
  STAGE=$(curl -s http://localhost:8080/qa-buddy-v2/discover/$DISCOVERY_ID | jq -r '.current_stage')
  
  echo "Status: $STATUS, Stage: $STAGE"
  
  if [ "$STATUS" = "completed" ]; then
    break
  fi
  
  if [ "$STATUS" = "failed" ]; then
    echo "Discovery failed!"
    exit 1
  fi
  
  sleep 10
done

# 3. Execute tests
curl -X POST http://localhost:8080/qa-buddy-v2/discover/$DISCOVERY_ID/test \
  -H "Content-Type: application/json" \
  -d '{
    "test_prompt": "test all forms and navigation"
  }'

# 4. View results
curl http://localhost:8080/qa-buddy-v2/discover/$DISCOVERY_ID | jq '.'
```

---

## Troubleshooting

### Issue: Login fails

**Symptoms:**
- `s1_login.status` = "failed"
- `login_success` = false

**Solutions:**
1. Verify credentials are correct
2. Use application URL (not Keycloak URL)
3. Check if Keycloak redirect is configured correctly
4. Review logs: `data/{discovery_id}/discovery.json`

### Issue: No pages discovered

**Symptoms:**
- `s2_pages.pages` = []
- `total_paths` = 0

**Solutions:**
1. Verify login was successful (check S1)
2. Check if application has navigation elements
3. Verify you're on the logged-in homepage
4. Check network connectivity

### Issue: Health check fails

**Symptoms:**
- `s4_health.health_status` = "unhealthy"
- Many pages with issues

**Solutions:**
1. Check network errors in `s4_health.network_errors`
2. Review console errors in `s4_health.console_errors`
3. Check if pages require additional authentication
4. Verify application is accessible

---

## API Reference

### QA Buddy V2 Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/qa-buddy-v2/discover` | POST | Start discovery flow |
| `/qa-buddy-v2/discover/stream` | POST | Start with SSE streaming |
| `/qa-buddy-v2/discover/{id}` | GET | Get discovery status |
| `/qa-buddy-v2/discover/{id}/test` | POST | Execute test prompt |

### Legacy Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/discover` | POST | Basic discovery |
| `/generate-tests` | POST | Generate smoke tests |
| `/run` | POST | Execute tests |
| `/run/{id}/report.html` | GET | Get HTML report |

---

## Next Steps

- Read [README.md](README.md) for architecture overview
- Check [KEYCLOAK_FLOW.md](KEYCLOAK_FLOW.md) for authentication details
- See [POSTMAN_COLLECTION.md](POSTMAN_COLLECTION.md) for API examples
- Review [docs/architecture.md](docs/architecture.md) for system design
