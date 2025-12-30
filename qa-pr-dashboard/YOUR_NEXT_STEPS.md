# Your Next Steps to Enable Flow Tracing

Based on your current setup, here's exactly what you need to do:

## Current Status ✅
- ✅ Node.js installed (v25.2.1)
- ✅ Docker installed
- ✅ API Server running (port 8000)
- ✅ Frontend running (port 3000)
- ❌ Docker services (Jaeger/Tempo) not running

## Quick Steps (5 minutes)

### Step 1: Start Docker Services

Open a terminal and run:

```bash
cd /Users/amitkumarnigam/Downloads/PlaywrightRecordPlayback/qa-pr-dashboard
docker compose -f docker-compose.tracing.yml up -d
```

**Expected output:**
```
[+] Running 3/3
 ✔ Container jaeger    Started
 ✔ Container tempo     Started  
 ✔ Container zipkin   Started
```

**Verify it's running:**
```bash
docker ps | grep -E "jaeger|tempo"
```

### Step 2: Configure API Server

Check if `.env` file exists:

```bash
cd /Users/amitkumarnigam/Downloads/PlaywrightRecordPlayback/qa-pr-dashboard/api-server
ls -la .env
```

If it doesn't exist, create it:

```bash
cat > .env << 'EOF'
TRACING_ENABLED=true
TRACING_SERVICE_NAME=qa-pr-dashboard-api
TRACING_EXPORTER=jaeger
JAEGER_ENDPOINT=http://localhost:4318/v1/traces
TRACE_COLLECTOR_ENABLED=true
TRACE_COLLECTOR_INTERVAL=30000
TRACING_BACKEND=jaeger
JAEGER_API_URL=http://localhost:16686
EOF
```

### Step 3: Restart API Server

**Stop the current API server:**
- Find the terminal where it's running
- Press `Ctrl+C` to stop it

**Or kill the process:**
```bash
pkill -f "node.*server.js"
```

**Start it again:**
```bash
cd /Users/amitkumarnigam/Downloads/PlaywrightRecordPlayback/qa-pr-dashboard/api-server
npm run dev
```

**Look for these messages:**
```
✅ OpenTelemetry tracing initialized
✅ Flow Analyzer service loaded
✅ Trace collector initialized (jaeger, interval: 30000ms)
```

### Step 4: Verify Everything Works

**Test 1: API Health**
```bash
curl http://localhost:8000/api/health
```
Should return: `{"status":"ok",...}`

**Test 2: Flow Endpoints**
```bash
curl http://localhost:8000/api/flows
```
Should return: `{"flows":[],"total":0,...}` (not 404)

**Test 3: Jaeger UI**
Open browser: **http://localhost:16686**
- Should see Jaeger UI
- Select service: `qa-pr-dashboard-api`
- Click "Find Traces"

**Test 4: Frontend**
1. Open: **http://localhost:3000**
2. Log in (if needed)
3. Click **"Flow Tracing"** tab
4. You should see the Flow Visualization interface

### Step 5: Generate Test Traces

Make some API calls to generate traces:

```bash
# From terminal
curl http://localhost:8000/api/health
curl http://localhost:8000/api/flows
curl http://localhost:8000/api/flows/operations
```

Or use the frontend:
- Click buttons, navigate pages
- Each action creates a trace

### Step 6: Wait and Check

1. **Wait 30-60 seconds** (trace collector runs every 30s)
2. **Check API server logs** for:
   ```
   📊 Found X traces in Jaeger
   ✅ Analyzed trace abc123... (3 services)
   ```
3. **Refresh Flow Tracing tab** in frontend
4. **Flows should appear** in the UI

---

## Quick Reference

### Service URLs
- **API Server**: http://localhost:8000
- **Frontend**: http://localhost:3000
- **Jaeger UI**: http://localhost:16686

### Useful Commands

```bash
# Check Docker services
docker ps | grep -E "jaeger|tempo"

# Check API server
curl http://localhost:8000/api/health

# Check flows
curl http://localhost:8000/api/flows

# View API server logs
# (in the terminal where npm run dev is running)
```

---

## Troubleshooting

### If Flow Endpoints Return 404
→ Restart API server (Step 3)

### If No Traces in Jaeger
→ Wait 10-20 seconds after making API calls

### If No Flows in UI
→ Wait 30-60 seconds for trace collection interval

### If Docker Services Won't Start
→ Check Docker Desktop is running: `docker ps`

---

## Full Documentation

For detailed instructions, see:
- **STEP_BY_STEP_ENABLE_TRACING.md** - Complete step-by-step guide
- **TRACE_COLLECTION_SETUP.md** - Trace collection details
- **FLOW_TRACING_IMPLEMENTATION.md** - Implementation details

---

## Or Use the Quick Script

Run the automated setup script:

```bash
cd /Users/amitkumarnigam/Downloads/PlaywrightRecordPlayback/qa-pr-dashboard
./QUICK_START_TRACING.sh
```

This will check everything and guide you through setup!

---

**That's it!** Follow these steps and you'll have flow tracing enabled in about 5 minutes! 🚀

