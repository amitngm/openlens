# Distributed Tracing Quick Start

## Quick Setup (5 minutes)

### 1. Start Tracing Backend

```bash
cd qa-pr-dashboard
docker-compose -f docker-compose.tracing.yml up -d
```

This starts:
- **Jaeger UI**: http://localhost:16686
- **Tempo UI**: http://localhost:3200
- **Zipkin UI**: http://localhost:9411

### 2. Configure API Server

Create `api-server/.env`:

```bash
TRACING_ENABLED=true
TRACING_SERVICE_NAME=qa-pr-dashboard-api
TRACING_EXPORTER=jaeger
JAEGER_ENDPOINT=http://localhost:4318/v1/traces
```

### 3. Restart API Server

```bash
cd api-server
npm run dev
```

You should see:
```
📊 Initializing Jaeger tracing: http://localhost:4318/v1/traces
✅ OpenTelemetry tracing initialized
```

### 4. Test It

1. **Open frontend**: http://localhost:3000
2. **Open browser console** (F12)
3. **Click any button** (e.g., "Sync Jira")
4. **Look for correlation ID** in console:
   ```
   [UI Action] [abc-123-def] syncJira
   [abc-123-def] API Response: POST /api/sync/jira - 200
   ```

5. **Open Jaeger**: http://localhost:16686
6. **Search for trace**:
   - Service: `qa-pr-dashboard-api`
   - Operation: `POST /api/sync/jira`
   - Or use trace ID from console

## Viewing Traces

### Method 1: Using Correlation ID

1. Get correlation ID from browser console
2. Query trace endpoint:
   ```bash
   curl http://localhost:8000/api/traces/abc-123-def
   ```
3. Open Jaeger link from response

### Method 2: Using Jaeger UI

1. Open http://localhost:16686
2. Select service: `qa-pr-dashboard-api`
3. Click "Find Traces"
4. Click on a trace to see full details

### Method 3: Using Browser Network Tab

1. Open browser DevTools → Network tab
2. Make a request
3. Check response headers: `X-Request-ID`
4. Use that ID to query `/api/traces/:id`

## What You'll See

### In Browser Console
```
[UI Action] [abc-123] fetchPRs { filters: {...} }
[abc-123] API Response: POST /api/prs - 200
```

### In API Server Logs
```
[abc-123] POST /api/prs { ip: '...', userAgent: '...' }
[abc-123] POST /api/prs 200 - 123ms
```

### In Jaeger UI
- **Service Map**: Visual graph of service calls
- **Trace Timeline**: Full request flow with timing
- **Span Details**: HTTP method, status code, duration, attributes

## Service Mesh (Optional)

For automatic service-to-service call visualization:

### Istio
```bash
kubectl label namespace qa-pr-dashboard istio-injection=enabled
kubectl apply -f k8s/deployment-api.yaml
kubectl apply -f k8s/deployment-frontend.yaml
```

Access Kiali: `kubectl port-forward -n istio-system svc/kiali 20001:20001`

### Linkerd
```bash
kubectl get deployment -n qa-pr-dashboard -o yaml | linkerd inject - | kubectl apply -f -
linkerd viz dashboard
```

## Troubleshooting

**No traces in Jaeger?**
- Check `TRACING_ENABLED=true` in `.env`
- Verify Jaeger is running: `docker ps | grep jaeger`
- Check API server logs for errors

**Correlation IDs not showing?**
- Check browser console for logs
- Verify `lib/tracing.ts` is imported in `lib/api.ts`
- Check Network tab for `X-Request-ID` header

**Service mesh not working?**
- Verify sidecar is injected: `kubectl get pod -o jsonpath='{.spec.containers[*].name}'`
- Check namespace label: `kubectl get namespace qa-pr-dashboard`

## Next Steps

- Read [SERVICE-MESH-TRACING.md](./SERVICE-MESH-TRACING.md) for detailed setup
- Configure trace sampling for production
- Add custom attributes to spans
- Set up alerts based on trace data



