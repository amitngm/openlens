# How to Verify Traceability is Working

This guide shows you how to check if distributed tracing is enabled and how to view traces.

## Quick Check: Is Tracing Enabled?

### 1. Check API Server Logs

When the API server starts, look for these messages:

**✅ Tracing Enabled:**
```
📊 Initializing Jaeger tracing: http://localhost:4318/v1/traces
✅ OpenTelemetry tracing initialized
```

**❌ Tracing Disabled:**
```
📊 Tracing is disabled (set TRACING_ENABLED=true to enable)
```

### 2. Check Environment Variables

```bash
cd qa-pr-dashboard/api-server
cat .env | grep TRACING
```

Should show:
```
TRACING_ENABLED=true
TRACING_SERVICE_NAME=qa-pr-dashboard-api
TRACING_EXPORTER=jaeger
```

### 3. Check Correlation IDs in Browser

1. Open http://localhost:3000
2. Open Browser Console (F12)
3. Click any button (e.g., "Sync Jira")
4. Look for logs like:
   ```
   [UI Action] [abc-123-def-456] syncJira
   [abc-123-def-456] API Response: POST /api/sync/jira - 200
   ```

**✅ If you see correlation IDs**: Tracing is working!

## Method 1: Check Browser Console (Easiest)

### Steps:
1. Open your app: http://localhost:3000
2. Open Developer Tools (F12)
3. Go to Console tab
4. Perform an action (click a button, load data)
5. Look for logs with correlation IDs:

```
[UI Action] [550e8400-e29b-41d4-a716-446655440000] fetchPRs
[550e8400-e29b-41d4-a716-446655440000] API Response: POST /api/prs - 200
```

**What this tells you:**
- ✅ Frontend is generating correlation IDs
- ✅ Correlation IDs are being sent to API
- ✅ API is responding with the same correlation ID

## Method 2: Check Network Tab

### Steps:
1. Open Developer Tools (F12)
2. Go to Network tab
3. Perform an action (make an API call)
4. Click on the request
5. Check Response Headers:

```
X-Request-ID: 550e8400-e29b-41d4-a716-446655440000
X-Trace-ID: 550e8400-e29b-41d4-a716-446655440000
Traceparent: 00-550e8400-e29b-41d4-a716-446655440000-789-01
```

**What this tells you:**
- ✅ API is receiving correlation IDs
- ✅ API is returning correlation IDs in response
- ✅ W3C Trace Context is being propagated

## Method 3: Check API Server Logs

### Steps:
1. Look at the terminal where API server is running
2. Make a request from the frontend
3. Look for logs like:

```
[550e8400-e29b-41d4-a716-446655440000] POST /api/sync/jira { ip: '::1', userAgent: 'Mozilla/5.0...' }
[550e8400-e29b-41d4-a716-446655440000] POST /api/sync/jira 200 - 1234ms
```

**What this tells you:**
- ✅ Correlation ID middleware is working
- ✅ Requests are being logged with correlation IDs
- ✅ Response times are being tracked

## Method 4: Query Trace Endpoint

### Steps:
1. Get a correlation ID from browser console or network tab
2. Query the trace endpoint:

```bash
curl http://localhost:8000/api/traces/550e8400-e29b-41d4-a716-446655440000
```

**Expected Response:**
```json
{
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "traceId": "550e8400-e29b-41d4-a716-446655440000",
  "otelTraceId": "def45678901234567890123456789012",
  "path": "/api/sync/jira",
  "method": "POST",
  "startTime": 1703078400000,
  "duration": 1234,
  "links": {
    "jaeger": "http://localhost:16686/trace/def45678901234567890123456789012"
  }
}
```

**What this tells you:**
- ✅ Trace endpoint is working
- ✅ OpenTelemetry trace ID is available
- ✅ You can view full trace in Jaeger

## Method 5: View Traces in Jaeger UI

### Prerequisites:
1. Start Jaeger:
   ```bash
   cd qa-pr-dashboard
   docker-compose -f docker-compose.tracing.yml up -d jaeger
   ```

2. Configure API server (create `api-server/.env`):
   ```bash
   TRACING_ENABLED=true
   TRACING_EXPORTER=jaeger
   JAEGER_ENDPOINT=http://localhost:4318/v1/traces
   ```

3. Restart API server

### Steps:
1. Open Jaeger UI: http://localhost:16686
2. Select service: `qa-pr-dashboard-api`
3. Click "Find Traces"
4. You should see traces appear!

**What you'll see:**
- Service map showing service dependencies
- Timeline view showing request flow
- Span details with HTTP method, status, duration
- Full trace from frontend → API → database

## Method 6: Test with a Simple Request

### Quick Test Script:

```bash
# Make a request and capture correlation ID
CORRELATION_ID=$(curl -s -X POST http://localhost:8000/api/sync/jira \
  -H "Content-Type: application/json" \
  -H "X-Request-ID: test-$(date +%s)" \
  -d '{}' \
  -w "%{http_header_x_request_id}" \
  -o /dev/null)

echo "Correlation ID: $CORRELATION_ID"

# Query trace info
curl http://localhost:8000/api/traces/$CORRELATION_ID
```

## Verification Checklist

Use this checklist to verify tracing is working:

- [ ] **API server logs show tracing initialization**
  - Look for: `✅ OpenTelemetry tracing initialized`

- [ ] **Browser console shows correlation IDs**
  - Look for: `[UI Action] [correlation-id] actionName`

- [ ] **Network tab shows trace headers**
  - Check for: `X-Request-ID`, `Traceparent` headers

- [ ] **API server logs include correlation IDs**
  - Look for: `[correlation-id] METHOD /path`

- [ ] **Trace endpoint returns trace info**
  - `curl http://localhost:8000/api/traces/:id` works

- [ ] **Jaeger UI shows traces** (if Jaeger is running)
  - Open http://localhost:16686 and see traces

## Common Issues

### Issue: No correlation IDs in browser console

**Solution:**
- Check if `lib/tracing.ts` is imported in `lib/api.ts`
- Verify frontend is making requests (check Network tab)
- Check browser console for JavaScript errors

### Issue: API server logs don't show correlation IDs

**Solution:**
- Verify `correlationIdMiddleware` is applied: `app.use(correlationIdMiddleware)`
- Check middleware is before routes in `server.js`
- Restart API server

### Issue: Jaeger shows no traces

**Solution:**
- Verify Jaeger is running: `docker ps | grep jaeger`
- Check `TRACING_ENABLED=true` in `.env`
- Verify `JAEGER_ENDPOINT` is correct
- Check API server logs for export errors

### Issue: Trace endpoint returns 404

**Solution:**
- Verify correlation ID exists (check API server logs)
- Correlation IDs are only stored while request is active
- Try making a new request and immediately querying it

## Quick Test Commands

```bash
# 1. Check if tracing is enabled
cd qa-pr-dashboard/api-server
grep TRACING .env || echo "Tracing not configured"

# 2. Check API server is running
curl http://localhost:8000/api/health

# 3. Make a test request and get correlation ID
curl -v http://localhost:8000/api/health 2>&1 | grep -i "x-request-id"

# 4. Check if Jaeger is running
docker ps | grep jaeger || echo "Jaeger not running"

# 5. Test trace endpoint (replace with actual correlation ID)
curl http://localhost:8000/api/traces/test-id
```

## Next Steps

Once you've verified tracing is working:

1. **View traces in Jaeger**: http://localhost:16686
2. **Add custom attributes** to spans for better debugging
3. **Set up alerts** based on trace data
4. **Configure trace sampling** for production
5. **Read full documentation**: [SERVICE-MESH-TRACING.md](./SERVICE-MESH-TRACING.md)




