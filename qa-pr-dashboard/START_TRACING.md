# Starting API Server with Trace Collection

## Quick Start Steps

### 1. Start Tracing Backend (Optional but Recommended)

If you have Docker installed and running:

```bash
cd qa-pr-dashboard
docker compose -f docker-compose.tracing.yml up -d
```

Or with older Docker Compose:
```bash
docker-compose -f docker-compose.tracing.yml up -d
```

This starts:
- **Jaeger UI**: http://localhost:16686
- **Tempo UI**: http://localhost:3200
- **Zipkin UI**: http://localhost:9411

**Note**: If Docker is not running, the API server will still start, but trace collection will be disabled until the backend is available.

### 2. Configure Environment (Optional)

Create `api-server/.env` file:

```bash
cd api-server
cat > .env << EOF
# Tracing Configuration
TRACING_ENABLED=true
TRACING_SERVICE_NAME=qa-pr-dashboard-api
TRACING_EXPORTER=jaeger
JAEGER_ENDPOINT=http://localhost:4318/v1/traces

# Trace Collector Configuration
TRACE_COLLECTOR_ENABLED=true
TRACE_COLLECTOR_INTERVAL=30000
TRACING_BACKEND=jaeger
JAEGER_API_URL=http://localhost:16686
EOF
```

**Note**: If `.env` doesn't exist, the server will use defaults (tracing enabled, Jaeger backend).

### 3. Start API Server

```bash
cd api-server
npm install  # If not already done
npm run dev
```

Expected output:
```
📊 Initializing Jaeger tracing: http://localhost:4318/v1/traces
✅ OpenTelemetry tracing initialized
✅ Flow Analyzer service loaded
✅ Flow Analyzer loaded for trace collection
✅ Trace collector initialized (jaeger, interval: 30000ms)
🚀 FlowLens API Server running on http://localhost:8000
📡 API endpoint: http://localhost:8000/api
💚 Health check: http://localhost:8000/api/health
```

### 4. Verify Everything is Working

#### Check API Server
```bash
curl http://localhost:8000/api/health
```

Should return:
```json
{"status":"ok","timestamp":"..."}
```

#### Check Flow Analyzer
```bash
curl http://localhost:8000/api/flows
```

Should return:
```json
{
  "flows": [],
  "total": 0,
  "page": 1,
  "pageSize": 20
}
```

#### Check Trace Collection Status
The trace collector will:
- Attempt to connect to Jaeger/Tempo every 30 seconds
- If backend is not available, it will silently skip (no errors)
- Once backend is available, it will start collecting traces automatically

### 5. Generate Test Traces

Make some API calls to generate traces:

```bash
# Health check
curl http://localhost:8000/api/health

# Get flows (will create a trace)
curl http://localhost:8000/api/flows

# Any other API endpoint
curl http://localhost:8000/api/jira/issues
```

### 6. View Traces

#### In Jaeger UI (if running)
1. Open http://localhost:16686
2. Select service: `qa-pr-dashboard-api`
3. Click "Find Traces"
4. You should see traces from your API calls

#### In Flow Visualization UI
1. Start the frontend: `npm run dev` (in project root)
2. Navigate to http://localhost:3000
3. Log in as admin or manager
4. Click on "Flow Tracing" tab
5. You should see flows appearing (after trace collection runs)

## Troubleshooting

### Docker Not Running

**Symptom**: `Cannot connect to the Docker daemon`

**Solution**: 
- Start Docker Desktop or Colima
- Or run without Docker - the API server will work, but trace collection will be disabled until backend is available

### Trace Collector Not Starting

**Symptom**: No `✅ Trace collector initialized` message

**Check**:
1. Verify `TRACE_COLLECTOR_ENABLED=true` (or not set, defaults to true)
2. Check server logs for errors
3. Verify `api-server/services/traceCollector.js` exists

### No Traces in Flow Visualization

**Possible Causes**:
1. **Jaeger/Tempo not running**: Start Docker services
2. **No traces generated**: Make some API calls
3. **Collection interval**: Wait 30 seconds for next collection
4. **Trace format**: Ensure traces have required attributes (service.name, etc.)

**Debug**:
```bash
# Check if traces are in Jaeger
curl http://localhost:16686/api/traces?service=qa-pr-dashboard-api

# Check API server logs for collection messages
# Look for: "✅ Analyzed trace ..."
```

### API Server Won't Start

**Check**:
1. Port 8000 is available: `lsof -i :8000`
2. Dependencies installed: `npm install`
3. Node.js version: `node --version` (should be 18+)

## Manual Trace Collection

If you want to manually trigger trace collection, you can add this endpoint to `server.js`:

```javascript
// Manual trace collection trigger
app.post('/api/flows/collect', asyncHandler(async (req, res) => {
  if (traceCollector) {
    await traceCollector.collectTracesNow();
    res.json({ success: true, message: 'Trace collection triggered' });
  } else {
    res.status(503).json({ error: 'Trace collector not available' });
  }
}));
```

Then trigger it:
```bash
curl -X POST http://localhost:8000/api/flows/collect
```

## Next Steps

1. **Start Frontend**: `npm run dev` (in project root)
2. **View Flows**: Navigate to "Flow Tracing" tab
3. **Generate Traces**: Make API calls to create traces
4. **Monitor**: Watch flows appear in real-time

## Related Documentation

- `TRACE_COLLECTION_SETUP.md` - Detailed setup guide
- `FLOW_TRACING_IMPLEMENTATION.md` - Implementation details
- `TRACING-QUICK-START.md` - Basic tracing setup
- `ARCHITECTURE_DISTRIBUTED_TRACING.md` - Architecture design

