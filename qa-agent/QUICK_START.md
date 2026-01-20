# QA Agent - Quick Start Guide

## Step-by-Step Usage Instructions

### Prerequisites

1. **Python 3.8+** installed
2. **Node.js 18+** installed
3. **Playwright** browser installed

---

## Step 1: Install Dependencies

### Install Python Dependencies

```bash
cd agent-api
pip install -r requirements.txt
playwright install chromium
```

### Install Node Dependencies

```bash
cd ui
npm install
```

---

## Step 2: Start the Services

### Terminal 1: Start API Server

```bash
cd agent-api
mkdir -p data
DATA_DIR=./data ALLOW_PROD=false uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
```

**Expected output:**
```
INFO:     Uvicorn running on http://0.0.0.0:8080
INFO:     Application startup complete.
```

### Terminal 2: Start UI Server

```bash
cd ui
npm run dev
```

**Expected output:**
```
  ▲ Next.js 14.x.x
  - Local:        http://localhost:3000
```

---

## Step 3: Verify Services Are Running

### Check API Health

```bash
curl http://localhost:8080/health
```

**Expected response:**
```json
{"status":"healthy","allow_prod":false}
```

### Check UI

Open browser: http://localhost:3000

You should see the QA Agent dashboard.

---

## Step 4: Use QA Buddy V2 (5-Step Flow)

### Option A: Using API (Recommended)

#### Step 4.1: Start Discovery

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
  "discovery_id": "abc123xyz",
  "status": "running",
  "current_stage": "S1",
  "message": "Discovery started..."
}
```

**Save the `discovery_id` for next steps!**

#### Step 4.2: Monitor Progress

Check status every 10-30 seconds:

```bash
curl http://localhost:8080/qa-buddy-v2/discover/abc123xyz
```

**Watch for:**
- `current_stage`: S1 → S2 → S3 → S4 → S5
- `status`: "running" → "completed"

**What each stage does:**
- **S1**: Logs into your application (handles Keycloak redirect)
- **S2**: Discovers all pages and navigation paths
- **S3**: Maps user permissions and accessible actions
- **S4**: Health checks all pages (loads, errors, performance)
- **S5**: Ready for test execution

#### Step 4.3: Wait for Completion

The discovery typically takes 2-5 minutes depending on:
- Number of pages
- Network speed
- Application complexity

**Check when complete:**
```bash
curl http://localhost:8080/qa-buddy-v2/discover/abc123xyz | jq '.status'
```

Should return: `"completed"`

#### Step 4.4: Review Results

```bash
curl http://localhost:8080/qa-buddy-v2/discover/abc123xyz | jq '.'
```

**Key information:**
- `s2_pages.pages`: List of all discovered pages
- `s3_access.total_actions`: Number of actions available
- `s4_health.health_status`: "healthy", "degraded", or "unhealthy"
- `s4_health.summary`: Health check summary

#### Step 4.5: Execute Tests (Optional)

After S1-S4 complete, run specific tests:

```bash
curl -X POST http://localhost:8080/qa-buddy-v2/discover/abc123xyz/test \
  -H "Content-Type: application/json" \
  -d '{
    "test_prompt": "test all forms"
  }'
```

**Supported test prompts:**
- `"test all forms"` - Validates all form pages
- `"test navigation"` - Tests link clicking and navigation
- `"test tables"` - Checks table rendering and data loading
- `"test login"` - Validates login flow

---

### Option B: Using UI (If Available)

1. **Open Dashboard**: http://localhost:3000
2. **Enter Details**:
   - Application URL
   - Username
   - Password
3. **Click "Start QA Buddy"**
4. **Monitor Progress**: Watch real-time updates
5. **View Reports**: Go to http://localhost:3000/reports

---

## Step 5: View Results

### View Discovery Results

```bash
# Get full discovery results
curl http://localhost:8080/qa-buddy-v2/discover/abc123xyz > discovery_results.json

# View in browser
cat discovery_results.json | jq '.'
```

### View Screenshots

Screenshots are saved in:
```
agent-api/data/abc123xyz/
├── s1_before_login.png
├── s1_after_login.png
├── s2_page_1.png
├── s2_page_2.png
├── s4_health_1.png
└── discovery.json
```

### View HTML Reports (For Legacy Runs)

If you used legacy endpoints (`/run`), view HTML reports:

```bash
# Get HTML report URL
echo "http://localhost:8080/run/{run_id}/report.html"

# Or via UI
open http://localhost:3000/reports
```

---

## Step 6: Complete Example Script

Here's a complete bash script to run the full workflow:

```bash
#!/bin/bash

# Configuration
API_URL="http://localhost:8080"
APP_URL="https://your-app.com"
USERNAME="your-username"
PASSWORD="your-password"

echo "🚀 Starting QA Buddy V2 Discovery..."

# Step 1: Start Discovery
DISCOVERY_RESPONSE=$(curl -s -X POST "$API_URL/qa-buddy-v2/discover" \
  -H "Content-Type: application/json" \
  -d "{
    \"application_url\": \"$APP_URL\",
    \"username\": \"$USERNAME\",
    \"password\": \"$PASSWORD\",
    \"env\": \"staging\",
    \"config_name\": \"keycloak\"
  }")

DISCOVERY_ID=$(echo $DISCOVERY_RESPONSE | jq -r '.discovery_id')
echo "✅ Discovery started: $DISCOVERY_ID"

# Step 2: Monitor Progress
echo "⏳ Waiting for discovery to complete..."
while true; do
  STATUS=$(curl -s "$API_URL/qa-buddy-v2/discover/$DISCOVERY_ID" | jq -r '.status')
  STAGE=$(curl -s "$API_URL/qa-buddy-v2/discover/$DISCOVERY_ID" | jq -r '.current_stage')
  
  echo "   Status: $STATUS | Stage: $STAGE"
  
  if [ "$STATUS" = "completed" ]; then
    echo "✅ Discovery completed!"
    break
  fi
  
  if [ "$STATUS" = "failed" ]; then
    echo "❌ Discovery failed!"
    curl -s "$API_URL/qa-buddy-v2/discover/$DISCOVERY_ID" | jq '.error'
    exit 1
  fi
  
  sleep 10
done

# Step 3: Show Summary
echo ""
echo "📊 Discovery Summary:"
curl -s "$API_URL/qa-buddy-v2/discover/$DISCOVERY_ID" | jq '{
  pages_found: .s2_pages.pages | length,
  total_actions: .s3_access.total_actions,
  health_status: .s4_health.health_status,
  healthy_pages: .s4_health.summary.healthy_pages
}'

# Step 4: Execute Tests
echo ""
echo "🧪 Executing tests..."
TEST_RESPONSE=$(curl -s -X POST "$API_URL/qa-buddy-v2/discover/$DISCOVERY_ID/test" \
  -H "Content-Type: application/json" \
  -d '{
    "test_prompt": "test all forms"
  }')

echo "✅ Tests started"
echo "   View results: $API_URL/qa-buddy-v2/discover/$DISCOVERY_ID"

# Step 5: Show Results Location
echo ""
echo "📁 Results saved in: agent-api/data/$DISCOVERY_ID/"
echo "🌐 View in browser: http://localhost:3000/reports"
```

Save as `run_qa_buddy.sh`, make executable, and run:
```bash
chmod +x run_qa_buddy.sh
./run_qa_buddy.sh
```

---

## Troubleshooting

### Issue: API Not Starting

**Check:**
```bash
# Is port 8080 in use?
lsof -i :8080

# Check Python version
python3 --version  # Should be 3.8+

# Check Playwright
playwright --version
```

**Solution:**
- Kill process on port 8080: `kill -9 $(lsof -t -i:8080)`
- Reinstall Playwright: `playwright install chromium`

### Issue: Login Fails (S1)

**Symptoms:**
- `s1_login.status` = "failed"
- `login_success` = false

**Solutions:**
1. ✅ Use **application URL** (not Keycloak URL)
2. ✅ Verify credentials are correct
3. ✅ Check if Keycloak redirect is working
4. ✅ Review logs: `agent-api/data/{discovery_id}/discovery.json`

**Example:**
```bash
# ✅ Correct
"application_url": "https://your-app.com"

# ❌ Wrong
"application_url": "https://keycloak.example.com/auth/..."
```

### Issue: No Pages Discovered (S2)

**Symptoms:**
- `s2_pages.pages` = []
- `total_paths` = 0

**Solutions:**
1. Verify S1 (login) was successful
2. Check if app has navigation elements (nav, sidebar, menu)
3. Verify you're on the logged-in homepage after login
4. Check network connectivity

### Issue: Health Check Fails (S4)

**Symptoms:**
- `s4_health.health_status` = "unhealthy"
- Many pages with issues

**Solutions:**
1. Check `s4_health.network_errors` for 4xx/5xx errors
2. Review `s4_health.console_errors` for JavaScript errors
3. Verify pages don't require additional authentication
4. Check if application is accessible

### Issue: UI Not Loading

**Check:**
```bash
# Is port 3000 in use?
lsof -i :3000

# Check Node version
node --version  # Should be 18+

# Reinstall dependencies
cd ui
rm -rf node_modules
npm install
```

---

## Quick Reference

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/qa-buddy-v2/discover` | POST | Start discovery |
| `/qa-buddy-v2/discover/{id}` | GET | Get status/results |
| `/qa-buddy-v2/discover/{id}/test` | POST | Execute tests |
| `/health` | GET | Health check |
| `/docs` | GET | API documentation |

### Key URLs

- **UI Dashboard**: http://localhost:3000
- **API**: http://localhost:8080
- **API Docs**: http://localhost:8080/docs
- **Reports**: http://localhost:3000/reports

### Environment Variables

```bash
# Data directory (where results are saved)
export DATA_DIR=./data

# Allow production testing (default: false)
export ALLOW_PROD=false
```

---

## Next Steps

1. **Read Documentation**:
   - [README.md](README.md) - Overview
   - [KEYCLOAK_FLOW.md](KEYCLOAK_FLOW.md) - Keycloak details
   - [USAGE_GUIDE.md](USAGE_GUIDE.md) - Detailed usage

2. **Explore API**:
   - Visit http://localhost:8080/docs
   - Try endpoints interactively

3. **View Examples**:
   - Check [POSTMAN_COLLECTION.md](POSTMAN_COLLECTION.md)
   - Import `QA_Agent_API.postman_collection.json` into Postman

---

## Support

- **API Health**: `curl http://localhost:8080/health`
- **Check Logs**: Look at terminal where API is running
- **View Discovery**: `cat agent-api/data/{discovery_id}/discovery.json | jq '.'`
