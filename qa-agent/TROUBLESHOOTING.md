# QA Agent - Troubleshooting Guide

## Common Issues and Solutions

### Issue: Discovery Failed at S2 - "No pages discovered"

**Symptoms:**
```json
{
  "status": "failed",
  "current_stage": "S2",
  "s1_login": {
    "status": "warning",
    "session_valid": true,
    "final_url": "https://your-app.com/onboarding"
  },
  "s2_pages": {
    "pages": [],
    "total_paths": 0
  },
  "error": "No pages discovered"
}
```

**Cause:**
- Login succeeded but redirected to onboarding/onboarding page
- Onboarding pages typically don't have navigation menus
- System can't find navigation links to trace

**Solutions:**

#### Solution 1: Start from Dashboard URL (Recommended)

Instead of starting from root URL, start from a page that has navigation:

```bash
curl -X POST http://localhost:8080/qa-buddy-v2/discover \
  -H "Content-Type: application/json" \
  -d '{
    "application_url": "https://n1devcmp-user.airteldev.com/dashboard",
    "username": "your-username",
    "password": "your-password",
    "env": "staging",
    "config_name": "keycloak"
  }'
```

#### Solution 2: Complete Onboarding First

1. Manually complete onboarding in browser
2. Note the URL you land on (e.g., `/dashboard`, `/home`)
3. Start discovery from that URL

#### Solution 3: Use Different Starting URL

Try these common URLs:
- `/dashboard`
- `/home`
- `/main`
- `/app`
- `/workspace`

---

### Issue: Login Fails (S1)

**Symptoms:**
```json
{
  "s1_login": {
    "status": "failed",
    "session_valid": false,
    "message": "Still on login page after submit"
  }
}
```

**Solutions:**

1. **Verify Credentials**
   - Check username/password are correct
   - Verify account is active

2. **Use Application URL (Not Keycloak URL)**
   ```json
   ✅ Correct: "application_url": "https://your-app.com"
   ❌ Wrong: "application_url": "https://keycloak.example.com/auth/..."
   ```

3. **Check Keycloak Configuration**
   - Verify Keycloak redirect is configured
   - Check if MFA is required
   - Verify session timeout settings

4. **View Screenshots**
   ```bash
   open agent-api/data/{discovery_id}/s1_after_login.png
   ```

---

### Issue: No Navigation Found (S2)

**Symptoms:**
- `s2_pages.total_paths = 0`
- `s2_pages.pages = []`

**Solutions:**

1. **Check Page Structure**
   - View screenshot: `agent-api/data/{discovery_id}/s2_page_*.png`
   - Verify page has navigation elements

2. **SPA Applications**
   - If using React/Vue/Angular, navigation might be client-side
   - Try waiting longer or using different selectors

3. **Custom Navigation**
   - App might use custom navigation structure
   - Check if navigation is hidden behind menu button

4. **Start from Different Page**
   - Try starting from a page you know has navigation
   - Use browser DevTools to inspect navigation structure

---

### Issue: Health Check Fails (S4)

**Symptoms:**
```json
{
  "s4_health": {
    "health_status": "unhealthy",
    "issues": [...]
  }
}
```

**Solutions:**

1. **Check Network Errors**
   ```bash
   curl http://localhost:8080/qa-buddy-v2/discover/{id} | jq '.s4_health.network_errors'
   ```

2. **Review Console Errors**
   ```bash
   curl http://localhost:8080/qa-buddy-v2/discover/{id} | jq '.s4_health.console_errors'
   ```

3. **Check Slow Requests**
   ```bash
   curl http://localhost:8080/qa-buddy-v2/discover/{id} | jq '.s4_health.slow_requests'
   ```

---

### Issue: Services Not Running

**Symptoms:**
- `curl: (7) Failed to connect`
- Connection refused

**Solutions:**

```bash
# Check if API is running
curl http://localhost:8080/health

# Check if UI is running
curl http://localhost:3000

# Restart services
./stop.sh
./start.sh
```

---

## Debugging Tips

### 1. View Screenshots

```bash
# List all screenshots
ls -la agent-api/data/{discovery_id}/*.png

# Open specific screenshot
open agent-api/data/{discovery_id}/s1_after_login.png
```

### 2. Check Discovery JSON

```bash
# View full discovery results
cat agent-api/data/{discovery_id}/discovery.json | jq '.'

# View specific stage
cat agent-api/data/{discovery_id}/discovery.json | jq '.s1_login'
```

### 3. Monitor Logs

```bash
# API logs (if running in terminal)
# Check terminal where uvicorn is running

# Or check log files
tail -f api.log
tail -f ui.log
```

### 4. Test API Directly

```bash
# Health check
curl http://localhost:8080/health

# Test discovery endpoint
curl -X POST http://localhost:8080/qa-buddy-v2/discover \
  -H "Content-Type: application/json" \
  -d '{"application_url": "https://example.com", "env": "staging"}'
```

---

## Best Practices

1. **Always use Application URL** (not Keycloak URL)
2. **Start from Dashboard/Home** (not onboarding)
3. **Wait for Completion** before running tests
4. **Check Screenshots** if discovery fails
5. **Review Error Messages** in discovery.json

---

## Getting Help

1. **Check Documentation:**
   - [HOW_TO_USE.md](HOW_TO_USE.md)
   - [QUICK_START.md](QUICK_START.md)
   - [KEYCLOAK_FLOW.md](KEYCLOAK_FLOW.md)

2. **View API Docs:**
   - http://localhost:8080/docs

3. **Check Discovery Results:**
   - `agent-api/data/{discovery_id}/discovery.json`
