# Trace Collection Setup Guide

This guide explains how to set up automatic trace collection from OpenTelemetry backends (Jaeger/Tempo) and integrate with the Flow Analyzer.

## Quick Start

### 1. Start Tracing Backend

Start Jaeger (recommended) or Tempo using Docker Compose:

```bash
cd qa-pr-dashboard
docker-compose -f docker-compose.tracing.yml up -d
```

This starts:
- **Jaeger UI**: http://localhost:16686
- **Tempo UI**: http://localhost:3200
- **Zipkin UI**: http://localhost:9411

### 2. Configure API Server

Create `api-server/.env` file (or copy from `.env.example`):

```bash
cd api-server
cp .env.example .env
```

Edit `.env` and configure:

```env
# Enable tracing
TRACING_ENABLED=true
TRACING_SERVICE_NAME=qa-pr-dashboard-api
TRACING_EXPORTER=jaeger
JAEGER_ENDPOINT=http://localhost:4318/v1/traces

# Enable trace collector (automatic flow analysis)
TRACE_COLLECTOR_ENABLED=true
TRACE_COLLECTOR_INTERVAL=30000  # Collect every 30 seconds
TRACING_BACKEND=jaeger          # or 'tempo'
JAEGER_API_URL=http://localhost:16686
```

### 3. Start API Server

```bash
cd api-server
npm install  # If not already done
npm run dev
```

You should see:
```
📊 Initializing Jaeger tracing: http://localhost:4318/v1/traces
✅ OpenTelemetry tracing initialized
✅ Flow Analyzer loaded for trace collection
✅ Trace collector initialized (jaeger, interval: 30000ms)
🚀 FlowLens API Server running on http://localhost:8000
```

### 4. Verify Trace Collection

1. **Check Jaeger UI**: http://localhost:16686
   - You should see traces from the API server
   - Make some API calls to generate traces

2. **Check Flow Analyzer**:
   - Navigate to "Flow Tracing" tab in the dashboard
   - You should see flows appearing automatically

3. **Check API Server Logs**:
   - Look for messages like: `✅ Analyzed trace abc123... (3 services)`

## How It Works

### Trace Flow

```
┌─────────────┐
│ API Server  │
│ (Generates  │
│  Traces)    │
└──────┬──────┘
       │
       │ OTLP HTTP
       │
┌──────▼──────┐
│   Jaeger    │
│  Backend    │
└──────┬──────┘
       │
       │ API Query
       │ (every 30s)
       │
┌──────▼──────┐
│   Trace     │
│  Collector  │
└──────┬──────┘
       │
       │ Analyze
       │
┌──────▼──────┐
│   Flow      │
│  Analyzer   │
└─────────────┘
```

### Trace Collection Process

1. **API Server** generates traces via OpenTelemetry middleware
2. **Traces** are sent to Jaeger/Tempo backend via OTLP
3. **Trace Collector** periodically queries Jaeger/Tempo API for recent traces
4. **Traces** are converted to Flow Analyzer format
5. **Flow Analyzer** processes traces and builds flow graphs
6. **Flow Graphs** are cached and available via `/api/flows` endpoints

## Configuration Options

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TRACE_COLLECTOR_ENABLED` | `true` | Enable/disable trace collection |
| `TRACE_COLLECTOR_INTERVAL` | `30000` | Collection interval in milliseconds |
| `TRACING_BACKEND` | `jaeger` | Backend to query (`jaeger` or `tempo`) |
| `JAEGER_API_URL` | `http://localhost:16686` | Jaeger API URL |
| `TEMPO_API_URL` | `http://localhost:3200` | Tempo API URL |
| `TRACING_SERVICE_NAME` | `qa-pr-dashboard-api` | Service name to filter traces |

### Collection Interval

- **30 seconds** (default): Good balance between freshness and API load
- **10 seconds**: More real-time, higher API load
- **60 seconds**: Less frequent, lower API load

### Backend Selection

**Jaeger** (recommended):
- Mature and stable
- Rich UI for debugging
- Good API support

**Tempo**:
- Grafana-native
- Good for Grafana users
- API may vary by version

## Troubleshooting

### No Traces Appearing

1. **Check Jaeger/Tempo is running**:
   ```bash
   docker ps | grep -E "jaeger|tempo"
   ```

2. **Check API server logs**:
   - Look for `✅ Trace collector initialized`
   - Look for `✅ Analyzed trace` messages

3. **Check trace collection**:
   - Verify `TRACE_COLLECTOR_ENABLED=true`
   - Check `TRACING_BACKEND` matches your backend

4. **Generate test traces**:
   - Make API calls to your server
   - Check Jaeger UI for traces
   - Wait for collection interval

### Connection Errors

If you see connection errors:

1. **Jaeger not running**:
   ```bash
   docker-compose -f docker-compose.tracing.yml up -d jaeger
   ```

2. **Wrong endpoint**:
   - Verify `JAEGER_API_URL` or `TEMPO_API_URL`
   - Check ports are correct (16686 for Jaeger UI)

3. **Network issues**:
   - Ensure API server can reach Jaeger/Tempo
   - Check firewall settings

### Flow Analyzer Not Working

1. **Check service is loaded**:
   - Look for `✅ Flow Analyzer loaded for trace collection`

2. **Check trace format**:
   - Traces need `service.name` attribute
   - Traces need span relationships (parent-child)

3. **Check API endpoints**:
   - Test `/api/flows` endpoint
   - Check for 503 errors (service unavailable)

## Manual Trace Collection

You can manually trigger trace collection via API:

```bash
# This endpoint doesn't exist yet, but you can add it
curl -X POST http://localhost:8000/api/flows/collect
```

Or restart the API server to trigger immediate collection.

## Advanced Configuration

### Custom Trace Filters

Edit `api-server/services/traceCollector.js` to add custom filters:

```javascript
// Only collect traces with specific tags
const response = await axios.get(`${JAEGER_API_URL}/api/traces`, {
  params: {
    service: 'qa-pr-dashboard-api',
    tags: 'operation.name=login',  // Filter by operation
    start: startTime,
    end: endTime,
  },
});
```

### Multiple Services

To collect traces from multiple services:

1. Query without service filter:
   ```javascript
   // Remove service parameter to get all services
   const response = await axios.get(`${JAEGER_API_URL}/api/traces`, {
     params: {
       start: startTime,
       end: endTime,
     },
   });
   ```

2. Filter in code:
   ```javascript
   const relevantTraces = traces.filter(trace => 
     trace.processes.some(p => 
       p.serviceName.startsWith('my-service-')
     )
   );
   ```

## Performance Considerations

- **Collection Interval**: Lower intervals = more API calls
- **Trace Volume**: High trace volume may slow down collection
- **Memory Usage**: Flow graphs are cached in memory
- **API Load**: Jaeger/Tempo API may throttle requests

## Next Steps

1. **Persistent Storage**: Move flow graphs to MongoDB
2. **Real-time Updates**: Use WebSockets for live updates
3. **Alerting**: Set up alerts for error rates
4. **Custom Dashboards**: Build custom Grafana dashboards

## Related Files

- `api-server/services/traceCollector.js` - Trace collector service
- `api-server/services/flowAnalyzer.js` - Flow analyzer service
- `api-server/middleware/opentelemetry.js` - OpenTelemetry setup
- `docker-compose.tracing.yml` - Tracing backend setup
- `FLOW_TRACING_IMPLEMENTATION.md` - Flow tracing implementation details

