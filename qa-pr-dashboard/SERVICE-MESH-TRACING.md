# Service Mesh & Distributed Tracing Guide

This guide explains how to use service mesh (Istio/Linkerd/Kuma) and distributed tracing to visualize service-to-service calls and track UI actions through the entire system.

## Overview

When you click a button in the UI, you can see exactly which services got hit:
- **Frontend** → **API Gateway** → **billing-svc** → **db-svc**

This is achieved through:
1. **Service Mesh** - Automatically captures service-to-service calls (no code changes needed)
2. **Distributed Tracing** - Correlates UI actions with backend traces using correlation IDs

## Architecture

```
┌─────────────┐
│   Browser   │
│  (Frontend) │
└──────┬──────┘
       │ x-request-id, traceparent
       ▼
┌─────────────────┐
│  Service Mesh   │  ← Automatically captures all calls
│  (Istio/Linkerd)│
└──────┬──────────┘
       │
       ▼
┌─────────────────┐     ┌──────────────┐     ┌─────────────┐
│  API Gateway    │────▶│  API Server  │────▶│  MongoDB    │
│  (Next.js)      │     │  (Express)   │     │             │
└─────────────────┘     └──────────────┘     └─────────────┘
       │                        │
       │                        │
       ▼                        ▼
┌─────────────────┐     ┌──────────────┐
│   Jaeger UI     │     │  Tempo UI    │
│  (Trace Viewer) │     │ (Trace Viewer)│
└─────────────────┘     └──────────────┘
```

## Option 1: Service Mesh (Best for "show me which services were invoked")

Service mesh automatically captures service-to-service calls without code changes.

### Istio Setup

1. **Install Istio** (if not already installed):
```bash
# Download Istio
curl -L https://istio.io/downloadIstio | sh -
cd istio-*

# Install Istio
./bin/istioctl install --set values.defaultRevision=default
```

2. **Enable Istio in your namespace**:
```bash
kubectl label namespace qa-pr-dashboard istio-injection=enabled
```

3. **Deploy your services** (they'll automatically get Istio sidecars):
```bash
kubectl apply -f k8s/deployment-api.yaml
kubectl apply -f k8s/deployment-frontend.yaml
```

4. **Access Kiali (Service Mesh UI)**:
```bash
kubectl port-forward -n istio-system svc/kiali 20001:20001
# Open http://localhost:20001
```

**Result**: You'll see a live graph showing:
- Frontend → API-Gateway → billing-svc → db-svc
- Request rates, error rates, latency for each service

### Linkerd Setup

1. **Install Linkerd**:
```bash
# Install Linkerd CLI
curl --proto '=https' --tlsv1.2 -sSfL https://run.linkerd.io/install-edge | sh

# Install Linkerd on cluster
linkerd install | kubectl apply -f -
```

2. **Inject Linkerd into your services**:
```bash
kubectl get deployment -n qa-pr-dashboard -o yaml | linkerd inject - | kubectl apply -f -
```

3. **Access Linkerd UI**:
```bash
linkerd viz dashboard
# Opens http://localhost:50750
```

### Kuma Setup

1. **Install Kuma**:
```bash
kubectl apply -f https://bit.ly/kuma-cp

# Or with Helm
helm repo add kuma https://kumahq.github.io/charts
helm install kuma kuma/kuma
```

2. **Enable Kuma in namespace**:
```bash
kubectl annotate namespace qa-pr-dashboard kuma.io/sidecar-injection=enabled
```

3. **Access Kuma UI**:
```bash
kubectl port-forward -n kuma-system svc/kuma-control-plane 5681:5681
# Open http://localhost:5681
```

## Option 2: Distributed Tracing with Correlation ID (Best for "one UI action → one trace")

This approach adds correlation IDs at the edge and propagates them through all services.

### How It Works

1. **Frontend generates correlation ID** when user clicks a button
2. **Every API call includes** `x-request-id` and `traceparent` headers
3. **Backend services propagate** the same headers to downstream services
4. **OpenTelemetry exports traces** to Jaeger/Tempo/Zipkin

### Current Implementation

The application already implements this:

#### Frontend (`lib/tracing.ts`)
- Generates correlation IDs using `crypto.randomUUID()`
- Creates W3C `traceparent` headers
- Logs UI actions with correlation IDs

#### Backend (`middleware/tracing.js`)
- Extracts correlation IDs from headers
- Creates OpenTelemetry spans
- Propagates trace headers to downstream services

### Viewing Traces

#### Using Jaeger

1. **Start Jaeger** (see docker-compose setup below):
```bash
docker-compose -f docker-compose.tracing.yml up -d
```

2. **Access Jaeger UI**: http://localhost:16686

3. **Find a trace**:
   - Use the correlation ID from browser console logs
   - Or search by service name: `qa-pr-dashboard-api`
   - Or search by operation: `GET /api/jira/issues`

#### Using Tempo

1. **Start Tempo** (see docker-compose setup below)

2. **Access Tempo UI**: http://localhost:3200

3. **Query traces** using trace ID or correlation ID

### Finding Correlation IDs

1. **Browser Console**: Look for logs like:
   ```
   [UI Action] [abc-123-def] fetchPRs
   [abc-123-def] API Response: POST /api/prs - 200
   ```

2. **API Response Headers**: Check `X-Request-ID` header

3. **Trace Endpoint**: Query `/api/traces/:correlationId` to get trace info

## Docker Compose Setup for Tracing

Create `docker-compose.tracing.yml`:

```yaml
version: '3.8'

services:
  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"  # Jaeger UI
      - "4317:4317"    # OTLP gRPC
      - "4318:4318"    # OTLP HTTP
    environment:
      - COLLECTOR_OTLP_ENABLED=true

  tempo:
    image: grafana/tempo:latest
    command: ["-config.file=/etc/tempo/tempo.yml"]
    ports:
      - "3200:3200"    # Tempo UI
      - "4317:4317"    # OTLP gRPC
      - "4318:4318"    # OTLP HTTP
    volumes:
      - ./tempo-config.yml:/etc/tempo/tempo.yml

  zipkin:
    image: openzipkin/zipkin:latest
    ports:
      - "9411:9411"    # Zipkin UI
```

Start tracing backends:
```bash
docker-compose -f docker-compose.tracing.yml up -d
```

## Configuration

### Environment Variables

**API Server** (`api-server/.env`):
```bash
# Enable tracing
TRACING_ENABLED=true

# Service name
TRACING_SERVICE_NAME=qa-pr-dashboard-api

# Exporter type: jaeger, tempo, zipkin, console
TRACING_EXPORTER=jaeger

# Jaeger endpoint (OTLP)
JAEGER_ENDPOINT=http://localhost:4318/v1/traces

# Tempo endpoint (OTLP)
TEMPO_ENDPOINT=http://localhost:4318/v1/traces

# Zipkin endpoint
ZIPKIN_ENDPOINT=http://localhost:9411/api/v2/spans
```

**Frontend** (`qa-pr-dashboard/.env.local`):
```bash
# API URL
NEXT_PUBLIC_API_URL=http://localhost:8000/api
```

## Usage Examples

### Example 1: Track a UI Action

1. **User clicks "Sync Jira" button**
2. **Frontend generates correlation ID**: `abc-123-def-456`
3. **API call includes headers**:
   ```
   X-Request-ID: abc-123-def-456
   Traceparent: 00-abc-123-def-456-789-01
   ```
4. **Backend creates span** with correlation ID
5. **View trace in Jaeger**:
   - Open http://localhost:16686
   - Search for trace ID or service: `qa-pr-dashboard-api`
   - See full trace: `POST /api/sync/jira` → `GET /api/jira/issues`

### Example 2: Service Mesh Visualization

1. **Deploy with Istio**:
   ```bash
   kubectl apply -f k8s/deployment-api.yaml
   kubectl apply -f k8s/deployment-frontend.yaml
   ```

2. **Access Kiali**:
   ```bash
   kubectl port-forward -n istio-system svc/kiali 20001:20001
   ```

3. **View service graph**:
   - See all service-to-service calls
   - View request rates, error rates, latency
   - Filter by time range

### Example 3: Correlate UI Action with Backend Trace

1. **Check browser console** for correlation ID:
   ```
   [UI Action] [abc-123] syncJira
   ```

2. **Query trace endpoint**:
   ```bash
   curl http://localhost:8000/api/traces/abc-123
   ```

3. **Response**:
   ```json
   {
     "correlationId": "abc-123",
     "traceId": "abc-123",
     "otelTraceId": "def-456-ghi-789",
     "path": "/api/sync/jira",
     "method": "POST",
     "duration": 1234,
     "links": {
       "jaeger": "http://localhost:16686/trace/def-456-ghi-789"
     }
   }
   ```

4. **Open Jaeger link** to see full trace

## Best Practices

1. **Always propagate trace headers** when making HTTP requests
2. **Use correlation IDs** in logs for easy debugging
3. **Set meaningful span names** (e.g., `GET /api/jira/issues` not just `GET`)
4. **Add custom attributes** to spans (user ID, request type, etc.)
5. **Monitor trace sampling** in production (don't trace 100% of requests)

## Troubleshooting

### Traces not appearing in Jaeger

1. Check if Jaeger is running: `docker ps | grep jaeger`
2. Verify endpoint: `curl http://localhost:4318/v1/traces`
3. Check environment variables: `TRACING_ENABLED=true`
4. Check logs for errors: `docker logs <jaeger-container>`

### Service mesh not capturing calls

1. Verify sidecar is injected: `kubectl get pod -o jsonpath='{.spec.containers[*].name}'`
2. Check Istio/Linkerd status: `istioctl proxy-status` or `linkerd check`
3. Verify namespace label: `kubectl get namespace qa-pr-dashboard -o yaml`

### Correlation IDs not propagating

1. Check browser console for correlation ID generation
2. Verify headers in Network tab: `X-Request-ID`, `Traceparent`
3. Check backend logs: `[correlation-id] GET /api/...`
4. Verify middleware is applied: `app.use(correlationIdMiddleware)`

## Additional Resources

- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [Istio Documentation](https://istio.io/latest/docs/)
- [Linkerd Documentation](https://linkerd.io/2.11/overview/)
- [Kuma Documentation](https://kuma.io/docs/)
- [Jaeger Documentation](https://www.jaegertracing.io/docs/)
- [Tempo Documentation](https://grafana.com/docs/tempo/latest/)




