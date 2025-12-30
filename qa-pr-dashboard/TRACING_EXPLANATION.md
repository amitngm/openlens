# How Tracing Works in This System

## Overview
This system uses **OpenTelemetry (OTEL)** for distributed tracing, with **Tempo** as the trace backend. Here's how it works:

## Architecture Flow

```
┌─────────────────┐
│  API Server     │
│  (Node.js)      │
└────────┬────────┘
         │
         │ 1. OpenTelemetry SDK
         │    (Auto-instrumentation)
         │
         ▼
┌─────────────────┐
│  OTEL Exporter  │
│  (OTLP HTTP)    │
└────────┬────────┘
         │
         │ 2. Send traces via OTLP
         │    Port: 4318
         │
         ▼
┌─────────────────┐
│  Tempo          │
│  (Trace Backend)│
│  Port: 3200     │
└────────┬────────┘
         │
         │ 3. Query traces
         │    Port: 3200 (API)
         │
         ▼
┌─────────────────┐
│  Trace Collector │
│  (Every 30s)     │
└────────┬────────┘
         │
         │ 4. Analyze traces
         │
         ▼
┌─────────────────┐
│  Flow Analyzer   │
│  (Build graphs)  │
└────────┬────────┘
         │
         │ 5. Display flows
         │
         ▼
┌─────────────────┐
│  UI Dashboard    │
│  (Flow Cards)    │
└─────────────────┘
```

## Components

### 1. **OpenTelemetry SDK** (`middleware/opentelemetry.js`)
- **Purpose**: Automatically instruments your Node.js application
- **What it does**:
  - Creates spans for HTTP requests automatically
  - Tracks database queries, HTTP calls, etc.
  - Exports traces to Tempo via OTLP protocol
- **Configuration**:
  ```env
  TRACING_ENABLED=true
  TRACING_EXPORTER=tempo
  TEMPO_ENDPOINT=http://localhost:4318/v1/traces
  TRACING_SERVICE_NAME=qa-pr-dashboard-api
  ```
- **Auto-instrumentation**: Automatically creates spans for:
  - Express HTTP requests
  - Axios HTTP calls
  - Database operations
  - File system operations (disabled to reduce noise)

### 2. **Tempo Backend** (Port 3200)
- **Purpose**: Stores and queries traces
- **OTLP Receiver**: Receives traces on port 4318
- **Query API**: Provides trace search on port 3200
- **Status Check**: `http://localhost:3200/ready`

### 3. **Trace Collector** (`services/traceCollector.js`)
- **Purpose**: Periodically fetches traces from Tempo and analyzes them
- **How it works**:
  1. Runs every 30 seconds (configurable)
  2. Queries Tempo API for recent traces
  3. Filters traces by namespace (ccs, dbaas)
  4. Sends traces to Flow Analyzer
- **Configuration**:
  ```env
  TRACE_COLLECTOR_ENABLED=true
  TRACE_COLLECTOR_INTERVAL=30000
  TRACING_BACKEND=tempo
  TEMPO_API_URL=http://localhost:3200
  TRACING_NAMESPACES=ccs,dbaas
  ```

### 4. **Flow Analyzer** (`services/flowAnalyzer.js`)
- **Purpose**: Converts raw traces into flow graphs
- **What it does**:
  - Extracts spans from traces
  - Identifies parent-child relationships
  - Maps spans to Kubernetes pods/services
  - Builds dependency graphs
  - Creates flow sequences with timestamps

### 5. **UI Dashboard** (`components/FlowVisualization.tsx`)
- **Purpose**: Displays flows to users
- **Features**:
  - Shows flow cards with chronological numbering
  - Displays pod sequences with timestamps
  - Allows searching for resources
  - Shows when requests reached each pod

## How Traces Are Generated

### Automatic Instrumentation
When a request comes to your API server:
1. OpenTelemetry SDK automatically creates a **span** for the HTTP request
2. If the request makes HTTP calls (via Axios), child spans are created
3. All spans are linked with **trace IDs** and **span IDs**
4. Spans include:
   - Start/end time
   - Duration
   - Attributes (HTTP method, URL, status code, etc.)
   - Pod/service information (if available)

### Manual Instrumentation
You can also create custom spans:
```javascript
import { getTracer } from './middleware/opentelemetry.js';

const tracer = getTracer('my-service');
const span = tracer.startSpan('my-operation');
// ... do work ...
span.end();
```

## Trace Flow Example

1. **Request arrives** → API Server receives HTTP request
2. **Span created** → OTEL SDK creates root span
3. **Request processed** → API makes calls to Kubernetes, databases, etc.
   - Each call creates a child span
4. **Trace exported** → All spans sent to Tempo via OTLP (port 4318)
5. **Tempo stores** → Traces stored in Tempo backend
6. **Collector queries** → Every 30s, collector queries Tempo API (port 3200)
7. **Flow Analyzer** → Analyzes traces and builds flow graphs
8. **UI displays** → Flow cards shown in dashboard

## Current Configuration Status

Based on your `.env` file:
- ✅ **TRACING_ENABLED=true** - Tracing is enabled
- ✅ **TRACING_EXPORTER=tempo** - Using Tempo exporter
- ✅ **TRACING_BACKEND=tempo** - Collector uses Tempo
- ✅ **Tempo is running** - Port 3200 is accessible
- ✅ **Tempo endpoint configured** - `http://localhost:4318/v1/traces`

## Verifying Tracing is Working

### Check if traces are being sent:
```bash
# Check Tempo is receiving traces
curl http://localhost:3200/api/search?limit=1

# Check API server logs for:
# "📊 Initializing Tempo tracing: http://localhost:4318/v1/traces"
# "✅ OpenTelemetry tracing initialized"
```

### Check if collector is running:
```bash
# Check API server logs for:
# "✅ Trace collector initialized (tempo, interval: 30000ms, namespaces: ccs, dbaas)"
```

### Check if flows are being generated:
- Open the Flow Traceability UI
- You should see flow cards if traces are being collected
- Check browser console for API calls to `/api/flows`

## Troubleshooting

### If Tempo is not receiving traces:
1. Check Tempo is running: `curl http://localhost:3200/ready`
2. Check OTLP endpoint: `http://localhost:4318/v1/traces` should be accessible
3. Check API server logs for export errors
4. Verify `TRACING_ENABLED=true` in `.env`

### If flows are not appearing:
1. Check collector is running (API server logs)
2. Check if traces exist in Tempo: `curl http://localhost:3200/api/search`
3. Verify namespace filter matches your pods: `TRACING_NAMESPACES=ccs,dbaas`
4. Check Flow Analyzer is processing traces (API server logs)

### If you want to use Jaeger instead:
1. Change `.env`:
   ```
   TRACING_EXPORTER=jaeger
   TRACING_BACKEND=jaeger
   JAEGER_ENDPOINT=http://localhost:4318/v1/traces
   JAEGER_API_URL=http://localhost:16686
   ```
2. Start Jaeger (usually via Docker)
3. Restart API server

## Key Points

1. **Tempo IS being used** - Your config shows `TRACING_EXPORTER=tempo` and `TRACING_BACKEND=tempo`
2. **Traces are sent to Tempo** - Via OTLP on port 4318
3. **Traces are collected from Tempo** - Via API on port 3200
4. **Flows are built from traces** - Flow Analyzer processes traces every 30s
5. **UI displays flows** - Flow cards show the request sequences

The system is fully configured to use Tempo for distributed tracing!


