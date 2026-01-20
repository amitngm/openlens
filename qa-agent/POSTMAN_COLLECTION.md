# Postman Collection - QA Agent API

Copy these curl commands into Postman's "Import" → "Raw text" or use them directly.

## Base URL
```
http://localhost:8080
```

---

## 1. Health Check

```bash
curl --location 'http://localhost:8080/health'
```

---

## 2. Start Discovery (Basic)

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

**Response:**
```json
{
    "discovery_id": "abc123...",
    "status": "pending"
}
```

---

## 3. Start QA Buddy Discovery (Advanced with SSE)

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

**Response:**
```json
{
    "discovery_id": "abc123...",
    "status": "pending"
}
```

---

## 4. Get Discovery Status

```bash
curl --location 'http://localhost:8080/discover/{discovery_id}'
```

**Example:**
```bash
curl --location 'http://localhost:8080/discover/4436f697-c4f'
```

**Response:**
```json
{
    "discovery_id": "4436f697-c4f",
    "status": "completed",
    "login_success": true,
    "pages": [...],
    "api_endpoints": [...]
}
```

---

## 5. Get QA Buddy Discovery Status

```bash
curl --location 'http://localhost:8080/qa-buddy/discover/{discovery_id}'
```

**Example:**
```bash
curl --location 'http://localhost:8080/qa-buddy/discover/4436f697-c4f'
```

---

## 6. Generate Tests from Discovery

```bash
curl --location 'http://localhost:8080/generate-tests' \
--header 'Content-Type: application/json' \
--data '{
    "discovery_id": "4436f697-c4f"
}'
```

**Response:**
```json
{
    "discovery_id": "4436f697-c4f",
    "tests_generated": 15,
    "preview": [...]
}
```

---

## 7. Start Test Run (Discovery-based)

```bash
curl --location 'http://localhost:8080/run' \
--header 'Content-Type: application/json' \
--data '{
    "discovery_id": "4436f697-c4f",
    "suite": "smoke"
}'
```

**Response:**
```json
{
    "run_id": "xyz789...",
    "status": "running"
}
```

---

## 8. Get Test Run Status

```bash
curl --location 'http://localhost:8080/run/{run_id}'
```

**Example:**
```bash
curl --location 'http://localhost:8080/run/xyz789'
```

**Response:**
```json
{
    "run_id": "xyz789",
    "status": "completed",
    "summary": {
        "total": 15,
        "passed": 12,
        "failed": 3
    }
}
```

---

## 9. Get HTML Report (Discovery-based Run)

```bash
curl --location 'http://localhost:8080/run/{run_id}/report.html'
```

**Example:**
```bash
curl --location 'http://localhost:8080/run/xyz789/report.html'
```

**Response:** HTML content (save to file or view in browser)

---

## 10. List All Runs

```bash
curl --location 'http://localhost:8080/run/runs'
```

---

## 11. Get Run Artifacts

```bash
curl --location 'http://localhost:8080/run/{run_id}/artifacts'
```

**Example:**
```bash
curl --location 'http://localhost:8080/run/xyz789/artifacts'
```

**Response:**
```json
[
    {
        "filename": "screenshot_1.png",
        "download_url": "/artifacts/xyz789/screenshot_1.png"
    }
]
```

---

## 12. Download Artifact

```bash
curl --location 'http://localhost:8080/artifacts/{run_id}/{filename}' \
--output screenshot.png
```

**Example:**
```bash
curl --location 'http://localhost:8080/artifacts/xyz789/screenshot_1.png' \
--output screenshot.png
```

---

## 13. Start Flow-based Test Run

```bash
curl --location 'http://localhost:8080/runs' \
--header 'Content-Type: application/json' \
--data '{
    "flow_id": "public-ip-allocation",
    "env": "staging"
}'
```

**Response:**
```json
{
    "run_id": "abc123...",
    "status": "running"
}
```

---

## 14. Get Flow Run Status

```bash
curl --location 'http://localhost:8080/runs/{run_id}'
```

---

## 15. Get Flow Run HTML Report

```bash
curl --location 'http://localhost:8080/runs/{run_id}/report.html'
```

---

## 16. List All Flow Runs

```bash
curl --location 'http://localhost:8080/runs'
```

---

## Quick Test Sequence

### Step 1: Start Discovery
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

**Save the `discovery_id` from response**

### Step 2: Check Discovery Status (wait 30-60 seconds)
```bash
curl --location 'http://localhost:8080/discover/YOUR_DISCOVERY_ID'
```

### Step 3: Generate Tests
```bash
curl --location 'http://localhost:8080/generate-tests' \
--header 'Content-Type: application/json' \
--data '{
    "discovery_id": "YOUR_DISCOVERY_ID"
}'
```

### Step 4: Run Tests
```bash
curl --location 'http://localhost:8080/run' \
--header 'Content-Type: application/json' \
--data '{
    "discovery_id": "YOUR_DISCOVERY_ID",
    "suite": "smoke"
}'
```

**Save the `run_id` from response**

### Step 5: Check Run Status (wait 1-2 minutes)
```bash
curl --location 'http://localhost:8080/run/YOUR_RUN_ID'
```

### Step 6: View HTML Report
```bash
# Open in browser or save to file
curl --location 'http://localhost:8080/run/YOUR_RUN_ID/report.html' \
--output report.html
```

---

## Postman Import Instructions

1. Open Postman
2. Click **Import** button (top left)
3. Select **Raw text** tab
4. Paste any curl command above
5. Click **Import**
6. Postman will automatically parse the request

**Or use Postman Collection JSON format:**

See `postman_collection.json` file (if available) for full collection import.
