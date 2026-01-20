# How to Use QA Agent - Complete Guide

## 🚀 Quick Start

### 1. Start Services

```bash
# Start both API and UI
./start.sh

# Or manually:
# Terminal 1: API
cd agent-api && source .venv/bin/activate
DATA_DIR=./data uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload

# Terminal 2: UI
cd ui && npm run dev
```

### 2. Access Services

- **UI Dashboard**: http://localhost:3000
- **API**: http://localhost:8080
- **API Docs**: http://localhost:8080/docs
- **Reports**: http://localhost:3000/reports

---

## 📋 QA Buddy V2 - Recommended Method

### Step 1: Start Discovery

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

### Step 2: Monitor Progress

```bash
# Check status
curl http://localhost:8080/qa-buddy-v2/discover/abc123

# Watch progress (updates every 10 seconds)
watch -n 10 'curl -s http://localhost:8080/qa-buddy-v2/discover/abc123 | jq "{stage: .current_stage, status: .status}"'
```

### Step 3: View Results

```bash
# Get full results
curl http://localhost:8080/qa-buddy-v2/discover/abc123 | jq '.'

# View summary
curl http://localhost:8080/qa-buddy-v2/discover/abc123 | jq '{
  status: .status,
  stage: .current_stage,
  pages: (.s2_pages.pages | length),
  actions: .s3_access.total_actions,
  health: .s4_health.health_status
}'
```

### Step 4: Execute Tests (S5)

```bash
curl -X POST http://localhost:8080/qa-buddy-v2/discover/abc123/test \
  -H "Content-Type: application/json" \
  -d '{
    "test_prompt": "test all forms"
  }'
```

---

## 📚 All Available Endpoints

### QA Buddy V2 (Recommended)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/qa-buddy-v2/discover` | Start 5-step discovery flow |
| POST | `/qa-buddy-v2/discover/stream` | Start with SSE streaming |
| GET | `/qa-buddy-v2/discover/{id}` | Get discovery status/results |
| POST | `/qa-buddy-v2/discover/{id}/test` | Execute test prompt (S5) |

### Legacy Discovery

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/discover` | Basic discovery |
| GET | `/discover/{id}` | Get discovery results |
| POST | `/generate-tests` | Generate smoke tests |
| POST | `/run` | Execute tests |
| GET | `/run/{id}` | Get run status |
| GET | `/run/{id}/report.html` | Get HTML report |
| GET | `/run/{id}/artifacts` | List artifacts |

### Utility

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/docs` | API documentation (Swagger) |
| GET | `/redoc` | API documentation (ReDoc) |

---

## 🔍 View All Collections

### List All Discoveries

```bash
# View all discovery directories
ls -la agent-api/data/

# Get summary of all collections
cd agent-api/data
for dir in */; do
  echo "=== ${dir%/} ==="
  if [ -f "$dir/discovery.json" ]; then
    cat "$dir/discovery.json" | jq '{status, current_stage, error}' 2>/dev/null
  fi
done
```

### View Specific Collection

```bash
# Via API (QA Buddy V2)
curl http://localhost:8080/qa-buddy-v2/discover/{discovery_id}

# Via API (Legacy)
curl http://localhost:8080/discover/{discovery_id}

# Direct file access
cat agent-api/data/{discovery_id}/discovery.json | jq '.'
```

### View Screenshots

```bash
# List screenshots
ls -la agent-api/data/{discovery_id}/*.png

# Open screenshot
open agent-api/data/{discovery_id}/s1_after_login.png
```

---

## 📊 Complete Workflow Examples

### Example 1: Full QA Buddy V2 Flow

```bash
#!/bin/bash

# Configuration
API_URL="http://localhost:8080"
APP_URL="https://your-app.com"
USERNAME="your-username"
PASSWORD="your-password"

# Step 1: Start Discovery
echo "🚀 Starting discovery..."
DISCOVERY=$(curl -s -X POST "$API_URL/qa-buddy-v2/discover" \
  -H "Content-Type: application/json" \
  -d "{
    \"application_url\": \"$APP_URL\",
    \"username\": \"$USERNAME\",
    \"password\": \"$PASSWORD\",
    \"env\": \"staging\",
    \"config_name\": \"keycloak\"
  }")

DISCOVERY_ID=$(echo $DISCOVERY | jq -r '.discovery_id')
echo "✅ Discovery ID: $DISCOVERY_ID"

# Step 2: Wait for completion
echo "⏳ Waiting for discovery..."
while true; do
  STATUS=$(curl -s "$API_URL/qa-buddy-v2/discover/$DISCOVERY_ID" | jq -r '.status')
  STAGE=$(curl -s "$API_URL/qa-buddy-v2/discover/$DISCOVERY_ID" | jq -r '.current_stage')
  echo "   Status: $STATUS | Stage: $STAGE"
  
  if [ "$STATUS" = "completed" ]; then
    break
  fi
  if [ "$STATUS" = "failed" ]; then
    echo "❌ Discovery failed!"
    exit 1
  fi
  sleep 10
done

# Step 3: Show results
echo ""
echo "📊 Results:"
curl -s "$API_URL/qa-buddy-v2/discover/$DISCOVERY_ID" | jq '{
  pages: (.s2_pages.pages | length),
  actions: .s3_access.total_actions,
  health: .s4_health.health_status
}'

# Step 4: Run tests
echo ""
echo "🧪 Running tests..."
curl -s -X POST "$API_URL/qa-buddy-v2/discover/$DISCOVERY_ID/test" \
  -H "Content-Type: application/json" \
  -d '{"test_prompt": "test all forms"}'

echo ""
echo "✅ Complete! View results: $API_URL/qa-buddy-v2/discover/$DISCOVERY_ID"
```

### Example 2: Using Postman

1. Import `QA_Agent_API.postman_collection.json` into Postman
2. Set variables:
   - `discovery_id`: Your discovery ID
   - `application_url`: Your app URL
3. Run requests in sequence

### Example 3: Using UI

1. Open http://localhost:3000
2. Enter application URL and credentials
3. Click "Start QA Buddy"
4. Monitor progress
5. View results in Reports page

---

## 🎯 Common Use Cases

### Use Case 1: Test Keycloak Login Flow

```bash
curl -X POST http://localhost:8080/qa-buddy-v2/discover \
  -H "Content-Type: application/json" \
  -d '{
    "application_url": "https://your-app.com",
    "username": "test-user",
    "password": "test-pass",
    "env": "staging",
    "config_name": "keycloak"
  }'
```

### Use Case 2: Health Check All Pages

After discovery completes, check S4 results:

```bash
curl http://localhost:8080/qa-buddy-v2/discover/{id} | jq '.s4_health'
```

### Use Case 3: Test Specific Features

```bash
# Test forms
curl -X POST http://localhost:8080/qa-buddy-v2/discover/{id}/test \
  -H "Content-Type: application/json" \
  -d '{"test_prompt": "test all forms"}'

# Test navigation
curl -X POST http://localhost:8080/qa-buddy-v2/discover/{id}/test \
  -H "Content-Type: application/json" \
  -d '{"test_prompt": "test navigation"}'

# Test tables
curl -X POST http://localhost:8080/qa-buddy-v2/discover/{id}/test \
  -H "Content-Type: application/json" \
  -d '{"test_prompt": "test tables"}'
```

---

## 📁 Collection Management

### View All Collections

```bash
# List all discovery IDs
ls agent-api/data/

# Get summary
cd agent-api/data
python3 << 'EOF'
import json
from pathlib import Path
for d in sorted(Path('.').iterdir()):
    if d.is_dir():
        f = d / 'discovery.json'
        if f.exists():
            data = json.load(open(f))
            print(f"{d.name}: {data.get('status')} - {data.get('current_stage', '-')}")
EOF
```

### Delete Old Collections

```bash
# Remove specific collection
rm -rf agent-api/data/{discovery_id}

# Remove all old collections (be careful!)
# rm -rf agent-api/data/*
```

### Export Collection

```bash
# Export discovery results
curl http://localhost:8080/qa-buddy-v2/discover/{id} > discovery_{id}.json

# Export with screenshots
tar -czf discovery_{id}.tar.gz agent-api/data/{id}/
```

---

## 🔧 Troubleshooting

### Issue: No Pages Discovered

**Solution:**
- Ensure you're past onboarding
- Start from a page with navigation (dashboard, home)
- Check if app uses custom navigation (SPA, React Router)

### Issue: Login Fails

**Solution:**
- Verify credentials
- Use application URL (not Keycloak URL)
- Check `s1_login` results for details

### Issue: Services Not Running

```bash
# Check if running
curl http://localhost:8080/health
curl http://localhost:3000

# Restart services
./stop.sh
./start.sh
```

---

## 📖 API Documentation

Interactive API documentation:
- **Swagger UI**: http://localhost:8080/docs
- **ReDoc**: http://localhost:8080/redoc

---

## 🎓 Learning Resources

- [QUICK_START.md](QUICK_START.md) - Step-by-step guide
- [README.md](README.md) - Overview
- [USAGE_GUIDE.md](USAGE_GUIDE.md) - Detailed usage
- [KEYCLOAK_FLOW.md](KEYCLOAK_FLOW.md) - Keycloak authentication
- [POSTMAN_COLLECTION.md](POSTMAN_COLLECTION.md) - Postman examples

---

## 💡 Tips

1. **Always use application URL** (not Keycloak URL)
2. **Wait for S1-S4 to complete** before running tests (S5)
3. **Check screenshots** if discovery fails
4. **Use SSE streaming** for real-time progress: `/qa-buddy-v2/discover/stream`
5. **View HTML reports** for legacy runs: `/run/{id}/report.html`

---

## 🚀 Ready to Use!

Your QA Agent is ready. Start with:

```bash
curl -X POST http://localhost:8080/qa-buddy-v2/discover \
  -H "Content-Type: application/json" \
  -d '{
    "application_url": "https://your-app.com",
    "username": "user",
    "password": "pass",
    "env": "staging"
  }'
```
