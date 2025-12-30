# Step-by-Step Guide: Enable Flow Tracing

This guide will walk you through enabling the complete flow tracing system step by step.

## Prerequisites Check

### Step 1: Verify Node.js and npm

```bash
node --version
# Should be v18 or higher

npm --version
# Should be v9 or higher
```

If not installed, download from: https://nodejs.org/

### Step 2: Verify Docker (Optional but Recommended)

```bash
docker --version
# Should show Docker version

docker ps
# Should not error (Docker daemon running)
```

**Note**: If Docker is not available, you can still run the API server, but trace collection will be disabled until a backend is available.

---

## Part 1: Start Tracing Backend (Jaeger/Tempo)

### Step 3: Navigate to Project Directory

```bash
cd /Users/amitkumarnigam/Downloads/PlaywrightRecordPlayback/qa-pr-dashboard
```

### Step 4: Start Docker Services

```bash
# Try new Docker Compose syntax first
docker compose -f docker-compose.tracing.yml up -d

# OR if that doesn't work, try old syntax
docker-compose -f docker-compose.tracing.yml up -d
```

**Expected Output:**
```
[+] Running 3/3
 ✔ Container jaeger    Started
 ✔ Container tempo     Started  
 ✔ Container zipkin   Started
```

### Step 5: Verify Services are Running

```bash
docker ps | grep -E "jaeger|tempo|zipkin"
```

You should see 3 containers running.

### Step 6: Verify Jaeger UI is Accessible

Open in browser: **http://localhost:16686**

You should see the Jaeger UI. If you see an error, wait 10-20 seconds for services to fully start.

**Alternative**: If Docker is not running, skip to Part 2. The API server will work without it.

---

## Part 2: Configure API Server

### Step 7: Navigate to API Server Directory

```bash
cd /Users/amitkumarnigam/Downloads/PlaywrightRecordPlayback/qa-pr-dashboard/api-server
```

### Step 8: Check if .env File Exists

```bash
ls -la .env
```

If it doesn't exist, we'll create it in the next step.

### Step 9: Create/Update .env File

Create or edit the `.env` file:

```bash
cat > .env << 'EOF'
# API Server Configuration
PORT=8000

# MongoDB Configuration (optional)
MONGODB_URI=mongodb://localhost:27017
DB_NAME=qa_pr_dashboard
SKIP_MONGO=false

# JWT Configuration
JWT_SECRET=your-secret-key-change-in-production

# OpenTelemetry Tracing Configuration
TRACING_ENABLED=true
TRACING_SERVICE_NAME=qa-pr-dashboard-api
TRACING_EXPORTER=jaeger
JAEGER_ENDPOINT=http://localhost:4318/v1/traces
TEMPO_ENDPOINT=http://localhost:4318/v1/traces
ZIPKIN_ENDPOINT=http://localhost:9411/api/v2/spans

# Trace Collector Configuration (for automatic flow analysis)
TRACE_COLLECTOR_ENABLED=true
TRACE_COLLECTOR_INTERVAL=30000
TRACING_BACKEND=jaeger
JAEGER_API_URL=http://localhost:16686
TEMPO_API_URL=http://localhost:3200
EOF
```

**Or manually edit**:
```bash
nano .env
# or
code .env
```

### Step 10: Verify Dependencies are Installed

```bash
npm install
```

This should complete without errors.

---

## Part 3: Start API Server

### Step 11: Stop Any Running API Server

If you have an API server running, stop it first:

```bash
# Find the process
ps aux | grep "node.*server.js" | grep -v grep

# Kill it (replace PID with actual process ID)
kill <PID>

# Or if running in terminal, press Ctrl+C
```

### Step 12: Start API Server

```bash
npm run dev
```

**Expected Output:**
```
📊 Initializing Jaeger tracing: http://localhost:4318/v1/traces
✅ OpenTelemetry tracing initialized
✅ Flow Analyzer service loaded
✅ Flow Analyzer loaded for trace collection
✅ Trace collector initialized (jaeger, interval: 30000ms)
🚀 FlowLens API Server running on http://localhost:8000
📡 API endpoint: http://localhost:8000/api
💚 Health check: http://localhost:8000/api/health
💾 MongoDB: mongodb://localhost:27017 (qa_pr_dashboard)
```

**Note**: If you see warnings about Flow Analyzer or Trace Collector not available, that's okay - they're optional.

### Step 13: Verify API Server is Running

Open a **new terminal** (keep the server running) and test:

```bash
curl http://localhost:8000/api/health
```

**Expected Response:**
```json
{"status":"ok","message":"API server is running"}
```

### Step 14: Test Flow Endpoints

```bash
# Test flows endpoint
curl http://localhost:8000/api/flows

# Expected: {"flows":[],"total":0,"page":1,"pageSize":20}
```

If you get a 404 error, the server may need to be restarted to load the new routes.

---

## Part 4: Generate Test Traces

### Step 15: Make Some API Calls

In a new terminal, make some API calls to generate traces:

```bash
# Health check
curl http://localhost:8000/api/health

# Get flows (this will create a trace)
curl http://localhost:8000/api/flows

# Get operations
curl http://localhost:8000/api/flows/operations

# Get dependencies
curl http://localhost:8000/api/flows/dependencies
```

### Step 16: Check Jaeger UI for Traces

1. Open browser: **http://localhost:16686**
2. In the **Service** dropdown, select: `qa-pr-dashboard-api`
3. Click **Find Traces**
4. You should see traces from your API calls

### Step 17: Wait for Trace Collection

The trace collector runs every 30 seconds. Wait 30-60 seconds, then check the API server logs. You should see:

```
📊 Found X traces in Jaeger
✅ Analyzed trace abc123... (3 services)
```

---

## Part 5: Start Frontend and View Flows

### Step 18: Navigate to Frontend Directory

Open a **new terminal**:

```bash
cd /Users/amitkumarnigam/Downloads/PlaywrightRecordPlayback/qa-pr-dashboard
```

### Step 19: Install Frontend Dependencies (if needed)

```bash
npm install
```

### Step 20: Start Frontend Server

```bash
npm run dev
```

**Expected Output:**
```
  ▲ Next.js 14.x.x
  - Local:        http://localhost:3000
  - ready started server on 0.0.0.0:3000
```

### Step 21: Open Browser

Open: **http://localhost:3000**

### Step 22: Log In

- If you have an account, log in
- Default admin credentials (if configured):
  - Username: `admin`
  - Password: `admin123`

### Step 23: Navigate to Flow Tracing Tab

1. After logging in, you'll see tabs at the top
2. Click on **"Flow Tracing"** tab (visible to admin/manager roles)
3. You should see the Flow Visualization interface

### Step 24: View Flows

1. **Service Dependencies**: Shows service dependency graph
2. **Recent Flows**: Lists recent flows (may be empty initially)
3. **Filters**: Use filters to find specific flows

### Step 25: Generate More Traces

1. Make more API calls from the frontend (click buttons, navigate)
2. Wait 30-60 seconds
3. Refresh the Flow Tracing tab
4. You should see flows appearing

---

## Part 6: Verify Everything is Working

### Step 26: Complete System Check

Run these checks:

```bash
# 1. API Server Health
curl http://localhost:8000/api/health
# Should return: {"status":"ok",...}

# 2. Flow Endpoints
curl http://localhost:8000/api/flows
# Should return: {"flows":[...],"total":X,...}

# 3. Jaeger UI
# Open: http://localhost:16686
# Should show traces

# 4. Frontend
# Open: http://localhost:3000
# Should show dashboard with Flow Tracing tab
```

### Step 27: Check Logs

Check API server logs for:
- ✅ OpenTelemetry tracing initialized
- ✅ Flow Analyzer service loaded
- ✅ Trace collector initialized
- ✅ Analyzed trace messages

---

## Troubleshooting

### Problem: Docker Services Won't Start

**Solution:**
```bash
# Check Docker is running
docker ps

# If not, start Docker Desktop or Colima
# Then try again:
docker compose -f docker-compose.tracing.yml up -d
```

**Workaround**: Skip Docker - API server will work, trace collection will be disabled until backend is available.

### Problem: API Server Won't Start

**Check:**
```bash
# Port 8000 in use?
lsof -i :8000

# Kill process if needed
kill <PID>

# Dependencies installed?
cd api-server && npm install
```

### Problem: Flow Endpoints Return 404

**Solution:**
1. Stop API server (Ctrl+C)
2. Restart: `npm run dev`
3. Wait for "Flow Tracing API endpoints registered" message

### Problem: No Traces in Jaeger

**Check:**
1. Jaeger is running: `docker ps | grep jaeger`
2. API server has `TRACING_ENABLED=true` in `.env`
3. Make some API calls
4. Wait 10-20 seconds for traces to appear

### Problem: No Flows in UI

**Check:**
1. Trace collector is running (check server logs)
2. Traces exist in Jaeger UI
3. Wait 30-60 seconds for collection interval
4. Check API server logs for "Analyzed trace" messages

### Problem: Flow Tracing Tab Not Visible

**Check:**
1. You're logged in as admin or manager
2. Check browser console for errors
3. Verify component is imported in `app/page.tsx`

---

## Quick Reference

### Service URLs

- **API Server**: http://localhost:8000
- **API Health**: http://localhost:8000/api/health
- **Frontend**: http://localhost:3000
- **Jaeger UI**: http://localhost:16686
- **Tempo UI**: http://localhost:3200
- **Zipkin UI**: http://localhost:9411

### Key Files

- **API Server Config**: `api-server/.env`
- **Flow Analyzer**: `api-server/services/flowAnalyzer.js`
- **Trace Collector**: `api-server/services/traceCollector.js`
- **Flow UI**: `components/FlowVisualization.tsx`

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TRACING_ENABLED` | `true` | Enable OpenTelemetry tracing |
| `TRACE_COLLECTOR_ENABLED` | `true` | Enable automatic trace collection |
| `TRACE_COLLECTOR_INTERVAL` | `30000` | Collection interval (ms) |
| `TRACING_BACKEND` | `jaeger` | Backend to use (`jaeger` or `tempo`) |

---

## Next Steps

Once everything is working:

1. **Explore Flows**: Make API calls and watch flows appear
2. **Filter Flows**: Use operation/environment filters
3. **View Details**: Click on flows to see detailed service flow
4. **Monitor**: Watch service dependencies build up
5. **Customize**: Adjust collection interval, add filters, etc.

---

## Summary Checklist

- [ ] Docker services running (Jaeger/Tempo)
- [ ] API server `.env` configured
- [ ] API server running on port 8000
- [ ] Flow endpoints responding
- [ ] Traces visible in Jaeger UI
- [ ] Frontend running on port 3000
- [ ] Flow Tracing tab visible
- [ ] Flows appearing in UI

**Congratulations!** Your flow tracing system is now enabled and running! 🎉

