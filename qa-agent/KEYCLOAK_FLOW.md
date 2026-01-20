# Keycloak Authentication Flow

## How It Works

The QA Agent now properly handles the complete Keycloak authentication flow:

### Flow Steps:

1. **Enter UI URL** → Navigate to your application URL
   ```
   https://n1devcmp-user.airteldev.com
   ```

2. **Automatic Redirect** → Application redirects to Keycloak login page
   ```
   https://keycloak.example.com/auth/realms/your-realm/protocol/openid-connect/auth?...
   ```

3. **Detect Login Page** → System automatically detects:
   - Username field (`#username`, `input[name='username']`)
   - Password field (`#password`, `input[name='password']`)
   - Submit button (`#kc-login`, `button[type='submit']`)

4. **Fill Credentials** → System fills:
   - Username in the detected field
   - Password in the detected field

5. **Submit Login** → Click submit button and wait for redirect

6. **Wait for Redirect** → System waits for Keycloak to redirect back:
   - Waits up to 30 seconds for navigation
   - Waits for `networkidle` state
   - Additional 3-5 seconds for OAuth/OIDC redirect flow

7. **Verify Redirect** → System checks:
   - Are we still on Keycloak domain? → Navigate back to application
   - Are we on the application domain? → Continue with discovery
   - Are we still on login page? → Login failed

8. **Continue Discovery** → If login successful:
   - Verify logged-in markers (nav, sidebar, menu)
   - Start crawling the application
   - Discover pages, forms, and APIs

## API Usage

### Start Discovery with Keycloak

```bash
curl --location 'http://localhost:8080/discover' \
--header 'Content-Type: application/json' \
--data '{
    "ui_url": "https://n1devcmp-user.airteldev.com",
    "username": "your-username",
    "password": "your-password",
    "env": "staging",
    "config_name": "keycloak"
}'
```

**Important:** Use your **application URL** (not the Keycloak URL). The system will:
- Navigate to your UI
- Follow redirect to Keycloak automatically
- Fill credentials on Keycloak page
- Wait for redirect back to your application
- Continue discovery on the logged-in application

### Or Use QA Buddy Discovery (Advanced)

```bash
curl --location 'http://localhost:8080/qa-buddy/discover' \
--header 'Content-Type: application/json' \
--data '{
    "application_url": "https://n1devcmp-user.airteldev.com",
    "username": "your-username",
    "password": "your-password",
    "env": "staging",
    "config_name": "keycloak"
}'
```

## What Happens Behind the Scenes

### 1. Initial Navigation
```python
# Navigate to application URL
await page.goto("https://n1devcmp-user.airteldev.com")
# Automatically redirects to Keycloak
```

### 2. Detect Keycloak Redirect
```python
current_url = page.url
is_keycloak_redirect = "keycloak" in current_url.lower() or "auth" in current_url.lower()
# Detects: https://keycloak.example.com/auth/...
```

### 3. Fill Credentials
```python
# Find username field
await page.locator("#username").fill(username)

# Find password field  
await page.locator("#password").fill(password)

# Click submit
await page.locator("#kc-login").click()
```

### 4. Wait for Redirect Back
```python
# Wait for navigation away from Keycloak
async with page.expect_navigation(timeout=30000, wait_until="networkidle"):
    await page.locator("#kc-login").click()

# Additional wait for OAuth redirect
await asyncio.sleep(3)
await page.wait_for_load_state("networkidle", timeout=20000)
```

### 5. Verify We're Back on Application
```python
current_url = page.url

# Check if still on Keycloak
is_still_on_keycloak = "keycloak" in current_url.lower()

# If still on Keycloak, navigate back to application
if is_still_on_keycloak:
    await page.goto(application_url, timeout=30000, wait_until="networkidle")
```

### 6. Verify Login Success
```python
# Check for logged-in markers
nav_markers = await page.locator("nav, .sidebar, .menu").count()

# Check if still on login page
is_on_login = "login" in page.url.lower()

# If markers found and not on login page → Success!
if nav_markers > 0 and not is_on_login:
    # Continue with discovery
```

## Troubleshooting

### Issue: `login_success: false`

**Possible causes:**
1. Wrong credentials
2. Keycloak redirect URL not configured correctly
3. Application URL incorrect (using Keycloak URL instead of app URL)

**Solution:**
- Use your **application URL**, not Keycloak URL
- Verify credentials are correct
- Check discovery logs for error messages

### Issue: Still on Keycloak after login

**Possible causes:**
1. Keycloak redirect callback not configured
2. Application session not established
3. Network timeout

**Solution:**
- Check Keycloak realm settings (redirect URIs)
- Increase wait times in config
- Check network logs for redirect issues

### Issue: Discovery finds 0 pages

**Possible causes:**
1. Login failed (check `login_success` in discovery result)
2. Application requires additional authentication steps
3. Application uses client-side routing (SPA)

**Solution:**
- Check `login_success` field in discovery result
- Verify you can manually log in and see pages
- Check if application is a SPA (may need different discovery approach)

## Configuration

The system uses Keycloak-specific selectors:

```python
"keycloak": {
    "username_selector": "#username, input[name='username']",
    "password_selector": "#password, input[name='password']",
    "submit_selector": "#kc-login, button[type='submit']",
    "success_indicator": "nav, .sidebar, .menu, .dashboard",
    "wait_after_login": 3000
}
```

These are automatically used when `config_name: "keycloak"` is specified.

## Example Discovery Result

```json
{
    "discovery_id": "abc123",
    "status": "completed",
    "login_success": true,
    "pages": [
        {
            "url": "https://n1devcmp-user.airteldev.com/dashboard",
            "title": "Dashboard"
        }
    ],
    "api_endpoints": [
        {
            "url": "https://api.example.com/v1/users",
            "method": "GET"
        }
    ]
}
```

## Next Steps

After successful discovery:
1. Generate tests: `POST /generate-tests`
2. Run tests: `POST /run`
3. View HTML report: `GET /run/{run_id}/report.html`
