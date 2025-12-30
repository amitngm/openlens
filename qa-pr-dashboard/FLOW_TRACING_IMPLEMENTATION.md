# Flow Tracing Implementation

## Overview

This document describes the implementation of the distributed flow tracing system for automatically tracking and visualizing microservice request flows. The implementation is **non-breaking** and **optional** - it integrates seamlessly with existing code without affecting current functionality.

## What Was Implemented

### 1. Flow Analyzer Service (`api-server/services/flowAnalyzer.js`)

A standalone service module that:
- Analyzes trace data and extracts service flow information
- Builds service dependency graphs from spans
- Calculates metrics (latency, error rates, call counts)
- Caches flow graphs and dependencies in memory
- Provides query functions for flows, dependencies, and operations

**Key Functions:**
- `analyzeTrace(traceData)` - Analyzes a trace and builds a flow graph
- `getFlowGraph(traceId)` - Retrieves a specific flow graph
- `getFlowGraphs(filters)` - Gets all flows with optional filters
- `getServiceDependencies(filters)` - Gets service dependency graph
- `getOperationStats(operationName, startTime, endTime)` - Gets statistics for an operation

### 2. Flow Tracing API Endpoints (`api-server/server.js`)

New REST API endpoints (lazy-loaded, won't break if service is unavailable):

- `GET /api/flows` - List all flows with filters
- `GET /api/flows/:flowId` - Get specific flow graph details
- `GET /api/flows/dependencies` - Get service dependency graph
- `GET /api/flows/operations` - List all operations
- `GET /api/flows/operations/:operationName/stats` - Get operation statistics
- `POST /api/flows/analyze` - Manually analyze a trace

**Features:**
- Lazy loading: Service is only loaded when first requested
- Graceful degradation: Returns 503 if service unavailable (doesn't crash)
- Non-breaking: Existing endpoints continue to work normally

### 3. Flow Visualization UI Component (`components/FlowVisualization.tsx`)

A React component that provides:
- **Service Dependency Graph** - Visual representation of service dependencies
- **Flow List** - Recent flows with filtering capabilities
- **Flow Detail Modal** - Detailed view of individual flows
- **Filters** - Operation, environment, time range filters
- **Metrics Display** - Latency, error rates, call counts

**Features:**
- Real-time flow fetching
- Interactive flow details
- Service dependency visualization
- Error handling with user-friendly messages

### 4. Integration with Main Dashboard (`app/page.tsx`)

Added a new "Flow Tracing" tab:
- Visible to admin and manager roles
- Integrated with existing tab system
- Uses session storage for tab persistence
- Follows existing UI patterns

## Architecture

```
┌─────────────────┐
│   Frontend UI   │
│ FlowVisualization│
└────────┬────────┘
         │
         │ HTTP REST API
         │
┌────────▼────────┐
│  API Server     │
│  /api/flows/*   │
└────────┬────────┘
         │
         │ Lazy Import
         │
┌────────▼────────┐
│ Flow Analyzer   │
│   Service       │
└────────┬────────┘
         │
         │ Analyzes
         │
┌────────▼────────┐
│  Trace Data     │
│ (OpenTelemetry) │
└─────────────────┘
```

## How It Works

1. **Trace Collection**: Existing OpenTelemetry middleware collects traces
2. **Trace Analysis**: Flow Analyzer processes traces and builds flow graphs
3. **Graph Storage**: Flow graphs cached in memory (can be moved to MongoDB)
4. **API Access**: REST endpoints provide access to flow data
5. **UI Visualization**: React component displays flows and dependencies

## Configuration

### Enable Flow Tracing

The flow tracing system is **automatically available** if:
- The `api-server/services/flowAnalyzer.js` file exists
- The API server can import the module

### Disable Flow Tracing

If you want to disable flow tracing:
1. Remove or rename `api-server/services/flowAnalyzer.js`
2. The API endpoints will return 503 (Service Unavailable)
3. The UI will show a friendly message that the service is unavailable
4. **No other functionality is affected**

## Usage

### Viewing Flows

1. Log in as admin or manager
2. Navigate to the "Flow Tracing" tab
3. View service dependencies and recent flows
4. Click on a flow to see detailed information

### Filtering Flows

- **Operation**: Filter by operation name (e.g., "login", "create_vm")
- **Environment**: Filter by environment (development, staging, production)
- **Time Range**: Filter by start and end time

### Analyzing Traces

To manually analyze a trace, send a POST request to `/api/flows/analyze`:

```json
{
  "traceData": {
    "traceId": "abc123...",
    "spans": [...],
    "operationName": "login",
    "uiEvent": "button_click"
  }
}
```

## Data Model

### Flow Graph

```typescript
{
  flowId: string
  traceId: string
  operationName: string
  uiEvent?: string
  startTime: number
  endTime: number
  duration: number
  nodes: FlowNode[]
  edges: FlowEdge[]
  metadata: {
    environment: string
    totalSpans: number
    serviceCount: number
    errorCount: number
  }
}
```

### Flow Node

```typescript
{
  id: string
  service: {
    name: string
    namespace: string
    pod: string
    version?: string
  }
  metrics: {
    requestCount: number
    errorCount: number
    avgLatency: number
    p50Latency: number
    p95Latency: number
    p99Latency: number
  }
  status: 'healthy' | 'degraded' | 'down'
}
```

### Flow Edge

```typescript
{
  from: string
  to: string
  callCount: number
  errorRate: number
  avgLatency: number
}
```

## Future Enhancements

1. **Persistent Storage**: Move flow graphs to MongoDB for persistence
2. **Real-time Updates**: WebSocket support for live flow updates
3. **Advanced Visualization**: Interactive graph visualization with D3.js or Cytoscape
4. **Alerting**: Set up alerts for error rates or latency thresholds
5. **Trace Collection Integration**: Automatic trace collection from OpenTelemetry backends
6. **Operation Tagging**: Automatic UI operation name extraction from frontend events

## Troubleshooting

### Flow Tracing Tab Not Visible

- Ensure you're logged in as admin or manager
- Check browser console for errors
- Verify the component is imported correctly

### No Flows Appearing

- Ensure tracing is enabled (`TRACING_ENABLED=true`)
- Verify services are sending trace data
- Check that trace data includes required attributes (service.name, k8s.namespace.name, etc.)

### API Returns 503

- This is expected if the Flow Analyzer service is not available
- Check that `api-server/services/flowAnalyzer.js` exists
- Check server logs for import errors

## Non-Breaking Design

This implementation follows these principles:

1. **Lazy Loading**: Service is only loaded when needed
2. **Graceful Degradation**: Returns 503 instead of crashing
3. **Optional Feature**: Can be completely disabled without affecting other features
4. **Isolated Code**: New code in separate files/modules
5. **No Breaking Changes**: Existing endpoints and functionality unchanged

## Testing

To test the flow tracing system:

1. Start the API server: `cd api-server && npm run dev`
2. Start the frontend: `npm run dev`
3. Log in as admin or manager
4. Navigate to "Flow Tracing" tab
5. If no flows appear, send a test trace to `/api/flows/analyze`

## Related Files

- `api-server/services/flowAnalyzer.js` - Flow analyzer service
- `api-server/server.js` - API endpoints (lines ~7636-7800)
- `components/FlowVisualization.tsx` - UI component
- `app/page.tsx` - Main dashboard integration
- `ARCHITECTURE_DISTRIBUTED_TRACING.md` - Architecture design document

