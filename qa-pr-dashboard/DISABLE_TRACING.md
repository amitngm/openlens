# What Happens When You Disable Tempo/Tracing

## Options to Disable Tracing

There are several ways to disable tracing, depending on what you want to achieve:

### Option 1: Disable Tracing Completely
**Set in `.env` file:**
```env
TRACING_ENABLED=false
```

**What happens:**
- ✅ OpenTelemetry SDK will NOT initialize
- ✅ No traces will be generated
- ✅ No traces will be exported to Tempo/Jaeger
- ✅ Trace collector will NOT run
- ✅ **Flow Traceability UI will show NO flows** (no data to display)
- ✅ API server continues to work normally (just without tracing)
- ✅ All other features work (Jira, Kubernetes, PRs, etc.)

**Console output:**
```
📊 Tracing is disabled (set TRACING_ENABLED=true to enable)
```

### Option 2: Disable Trace Collector Only
**Set in `.env` file:**
```env
TRACE_COLLECTOR_ENABLED=false
TRACING_ENABLED=true  # Keep this true
```

**What happens:**
- ✅ OpenTelemetry SDK WILL initialize
- ✅ Traces WILL be generated and exported to Tempo
- ✅ Traces WILL be stored in Tempo backend
- ❌ Trace collector will NOT run
- ❌ **Flow Traceability UI will show NO flows** (collector not fetching from Tempo)
- ✅ You can still view traces directly in Tempo UI (http://localhost:3200)
- ✅ API server works normally

**Console output:**
```
📊 Initializing Tempo tracing: http://localhost:4318/v1/traces
✅ OpenTelemetry tracing initialized
📊 Trace collector is disabled (set TRACE_COLLECTOR_ENABLED=true to enable)
```

### Option 3: Use Console Exporter (Development Only)
**Set in `.env` file:**
```env
TRACING_ENABLED=true
TRACING_EXPORTER=console
```

**What happens:**
- ✅ OpenTelemetry SDK WILL initialize
- ✅ Traces WILL be generated
- ✅ Traces will be printed to console (not sent to Tempo)
- ❌ Trace collector cannot collect (no backend to query)
- ❌ **Flow Traceability UI will show NO flows**
- ✅ Useful for debugging trace generation

**Console output:**
```
📊 Using console exporter for tracing
✅ OpenTelemetry tracing initialized
[Trace output printed to console]
```

### Option 4: Disable Tempo Backend (Keep Tracing Enabled)
**Stop Tempo container:**
```bash
docker stop tempo
# or
podman stop tempo
```

**What happens:**
- ✅ OpenTelemetry SDK WILL initialize
- ⚠️ Traces WILL be generated but export will FAIL
- ❌ Traces will NOT be stored (Tempo not running)
- ❌ Trace collector will NOT be able to query Tempo
- ❌ **Flow Traceability UI will show NO flows**
- ⚠️ API server logs will show export errors

**Console output:**
```
📊 Initializing Tempo tracing: http://localhost:4318/v1/traces
✅ OpenTelemetry tracing initialized
❌ Failed to export trace: connect ECONNREFUSED 127.0.0.1:4318
```

## Impact on Features

### ✅ Features That Still Work:
- **Jira Integration** - Fully functional
- **Kubernetes Management** - Fully functional
- **PR Dashboard** - Fully functional
- **User Management** - Fully functional
- **All API Endpoints** - Fully functional
- **Logs Viewer** - Fully functional

### ❌ Features That Stop Working:
- **Flow Traceability** - No flows will be displayed
- **Flow Search** - No flows to search
- **Pod Sequence Visualization** - No trace data
- **Request Flow Timeline** - No trace data
- **Trace-to-Logs Correlation** - No trace data

## Recommended Approach

### For Development/Testing:
```env
TRACING_ENABLED=true
TRACING_EXPORTER=console
TRACE_COLLECTOR_ENABLED=false
```
- See traces in console for debugging
- No backend needed
- No flows in UI (expected)

### For Production (No Tracing):
```env
TRACING_ENABLED=false
```
- Cleanest approach
- No overhead
- No flows in UI (expected)

### For Production (Tracing but No Flows):
```env
TRACING_ENABLED=true
TRACING_EXPORTER=tempo
TRACE_COLLECTOR_ENABLED=false
```
- Traces stored in Tempo
- Can view in Tempo UI directly
- No flows in dashboard UI

## UI Behavior When Tracing is Disabled

### Flow Traceability Page:
- Shows message: "No flows found" or "Tracing not enabled"
- Search functionality disabled
- No flow cards displayed
- Prerequisites check will show warnings

### Prerequisites Check:
The UI automatically detects if tracing is enabled:
- Checks if Tempo/Jaeger is running
- Shows appropriate messages
- Guides user to enable tracing if needed

## How to Re-enable

### Re-enable Tracing:
1. Set in `.env`:
   ```env
   TRACING_ENABLED=true
   TRACING_EXPORTER=tempo
   TRACE_COLLECTOR_ENABLED=true
   TRACING_BACKEND=tempo
   ```

2. Ensure Tempo is running:
   ```bash
   docker-compose -f docker-compose.tracing.yml up -d tempo
   # or
   podman-compose -f docker-compose.tracing.yml up -d tempo
   ```

3. Restart API server:
   ```bash
   npm start
   ```

4. Wait 30 seconds for collector to run
5. Refresh Flow Traceability UI

## Summary

| Setting | Traces Generated | Traces Exported | Collector Runs | Flows in UI |
|---------|------------------|-----------------|----------------|-------------|
| `TRACING_ENABLED=false` | ❌ No | ❌ No | ❌ No | ❌ No |
| `TRACE_COLLECTOR_ENABLED=false` | ✅ Yes | ✅ Yes | ❌ No | ❌ No |
| `TRACING_EXPORTER=console` | ✅ Yes | 📝 Console | ❌ No | ❌ No |
| Tempo stopped | ✅ Yes | ❌ Fails | ❌ No | ❌ No |
| All enabled | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |

**Key Point:** The Flow Traceability feature requires BOTH tracing enabled AND collector enabled to display flows in the UI.

