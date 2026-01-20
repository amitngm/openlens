# Quick Start - Interactive QA Buddy

## 🚀 3-Step Quick Start

### Step 1: Start the Server

```bash
cd qa-agent/agent-api
uvicorn app.main:app --reload
```

Server runs at: `http://localhost:8000`

### Step 2: Start a Run

```bash
curl -X POST "http://localhost:8000/api/runs/start" \
  -H "Content-Type: application/json" \
  -d '{
    "base_url": "https://your-app.com",
    "env": "dev"
  }'
```

**Save the `run_id` from the response!**

### Step 3: Answer Questions

The system will ask questions. Answer them:

```bash
# Login credentials
curl -X POST "http://localhost:8000/api/runs/{run_id}/answer" \
  -H "Content-Type: application/json" \
  -d '{"question_id": "login_creds", "answer": "user,pass"}'

# Context selection (if asked)
curl -X POST "http://localhost:8000/api/runs/{run_id}/answer" \
  -H "Content-Type: application/json" \
  -d '{"question_id": "context_select", "answer": "tenant_a"}'

# Test intent (after discovery)
curl -X POST "http://localhost:8000/api/runs/{run_id}/answer" \
  -H "Content-Type: application/json" \
  -d '{"question_id": "test_intent", "answer": "smoke"}'
```

### Check Status Anytime

```bash
curl "http://localhost:8000/api/runs/{run_id}/status"
```

### Get Report When Done

```bash
curl "http://localhost:8000/api/runs/{run_id}/report" > report.html
```

## 📋 Common Questions

### Q: What questions will I be asked?

1. **Login** (if needed): `"username,password"`
2. **Context** (if multiple): Select from options like `"tenant_a"`
3. **Test Type** (after discovery): `"smoke"`, `"crud_sanity"`, `"module_based"`, or `"exploratory_15m"`

### Q: How do I know what to answer?

Check the status endpoint - it shows the question and available options:

```bash
curl "http://localhost:8000/api/runs/{run_id}/status" | jq '.question'
```

### Q: How long does it take?

- Login: ~5-10 seconds
- Discovery: ~30-60 seconds (depends on pages)
- Test execution: ~1-5 minutes (depends on tests)
- **Total: ~2-10 minutes**

### Q: Where are results saved?

All artifacts in: `artifacts/{run_id}/`
- `report.html` - View in browser
- `report.json` - Machine-readable results
- Screenshots - On failures

## 🎯 Example: Complete Flow

```bash
# 1. Start
RUN_ID=$(curl -s -X POST "http://localhost:8000/api/runs/start" \
  -H "Content-Type: application/json" \
  -d '{"base_url": "https://app.example.com"}' \
  | jq -r '.run_id')

# 2. Check status
curl "http://localhost:8000/api/runs/$RUN_ID/status" | jq

# 3. Answer login (if asked)
curl -X POST "http://localhost:8000/api/runs/$RUN_ID/answer" \
  -H "Content-Type: application/json" \
  -d '{"question_id": "login_creds", "answer": "admin,secret"}'

# 4. Wait and check
sleep 10
curl "http://localhost:8000/api/runs/$RUN_ID/status" | jq

# 5. Answer test intent (when asked)
curl -X POST "http://localhost:8000/api/runs/$RUN_ID/answer" \
  -H "Content-Type: application/json" \
  -d '{"question_id": "test_intent", "answer": "smoke"}'

# 6. Wait for completion
sleep 60
curl "http://localhost:8000/api/runs/$RUN_ID/status" | jq

# 7. Get report
curl "http://localhost:8000/api/runs/$RUN_ID/report" > report.html
open report.html
```

## 🔗 API Endpoints

| What | Endpoint | Method |
|------|----------|--------|
| Start run | `/api/runs/start` | POST |
| Check status | `/api/runs/{id}/status` | GET |
| Answer question | `/api/runs/{id}/answer` | POST |
| Get report | `/api/runs/{id}/report` | GET |

## 📚 More Help

- **Full Guide**: See `HOW_TO_USE.md`
- **API Docs**: Visit `http://localhost:8000/docs`
- **Test Script**: `python3 test_interactive_flow.py --mock`
