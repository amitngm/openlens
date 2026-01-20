# Postman Collection - Import Guide

## 📥 How to Import

### Method 1: Import File (Recommended)

1. **Open Postman**
2. **Click "Import"** button (top left)
3. **Select "Upload Files"** tab
4. **Choose file**: `QA_Agent_API.postman_collection.json`
5. **Click "Import"**

### Method 2: Import from URL

1. **Open Postman**
2. **Click "Import"**
3. **Paste file path or URL**
4. **Click "Import"**

---

## 🎯 Collection Structure

The collection includes:

### 1. Health & Utility
- Health Check
- API Documentation

### 2. QA Buddy V2 (Recommended) ⭐
- Start Discovery
- Start Discovery (SSE Stream)
- Get Discovery Status
- Execute Test (S5)

### 3. Legacy Discovery
- Start Discovery (Basic)
- Get Discovery Status

### 4. Test Generation
- Generate Tests
- Get Generated Tests

### 5. Test Execution
- Start Test Run
- Get Run Status
- Get HTML Report
- List All Runs
- Get Run Artifacts

### 6. Flow-based Tests
- Start Flow Run
- Get Flow Run Status
- Get Flow Run HTML Report
- List All Flow Runs

---

## 🔧 Setup Variables

After importing, set these variables in Postman:

1. **Click on collection name** → "Variables" tab
2. Set variables:

| Variable | Value | Description |
|----------|-------|-------------|
| `base_url` | `http://localhost:8080` | API base URL |
| `discovery_id` | `f5864810-ca1` | Your discovery ID |
| `run_id` | (leave empty) | Run ID (set after starting run) |
| `filename` | `screenshot_1.png` | Artifact filename |

---

## 🚀 Quick Start Workflow

### Step 1: Start Discovery

1. Open **"QA Buddy V2"** → **"Start Discovery"**
2. Update body with your details:
   ```json
   {
     "application_url": "https://your-app.com",
     "username": "your-username",
     "password": "your-password",
     "env": "staging",
     "config_name": "keycloak"
   }
   ```
3. Click **"Send"**
4. Copy the `discovery_id` from response

### Step 2: Set Discovery ID

1. Go to collection **Variables**
2. Set `discovery_id` = (the ID from Step 1)
3. Save

### Step 3: Check Status

1. Open **"Get Discovery Status"**
2. Click **"Send"**
3. Watch for `current_stage`: S1 → S2 → S3 → S4 → S5

### Step 4: Execute Tests (After S1-S4 Complete)

1. Open **"Execute Test (S5)"**
2. Update body:
   ```json
   {
     "test_prompt": "test all forms"
   }
   ```
3. Click **"Send"**

---

## 📝 Example Requests

### Start QA Buddy V2 Discovery

**Request:**
```
POST http://localhost:8080/qa-buddy-v2/discover
```

**Body:**
```json
{
  "application_url": "https://n1devcmp-user.airteldev.com",
  "username": "your-username",
  "password": "your-password",
  "env": "staging",
  "config_name": "keycloak"
}
```

**Response:**
```json
{
  "discovery_id": "abc123",
  "status": "running",
  "current_stage": "S1"
}
```

### Get Discovery Status

**Request:**
```
GET http://localhost:8080/qa-buddy-v2/discover/{{discovery_id}}
```

**Response:**
```json
{
  "discovery_id": "abc123",
  "status": "completed",
  "current_stage": "S5",
  "s1_login": {...},
  "s2_pages": {...},
  "s3_access": {...},
  "s4_health": {...},
  "s5_tests": {...}
}
```

### Execute Test

**Request:**
```
POST http://localhost:8080/qa-buddy-v2/discover/{{discovery_id}}/test
```

**Body:**
```json
{
  "test_prompt": "test all forms"
}
```

---

## 💡 Tips

1. **Use Variables**: Set `discovery_id` and `run_id` as variables to reuse across requests
2. **Save Responses**: Right-click response → "Save Response" to keep examples
3. **Create Environment**: Create a Postman Environment for different stages (dev, staging, prod)
4. **Use Tests Tab**: Add JavaScript tests to automatically extract `discovery_id` from responses

### Auto-extract Discovery ID

Add this to "Tests" tab of "Start Discovery" request:

```javascript
if (pm.response.code === 200) {
    var jsonData = pm.response.json();
    pm.collectionVariables.set("discovery_id", jsonData.discovery_id);
    console.log("Discovery ID saved:", jsonData.discovery_id);
}
```

---

## 📁 File Location

```
qa-agent/QA_Agent_API.postman_collection.json
```

---

## ✅ Collection Features

- ✅ All QA Buddy V2 endpoints
- ✅ Legacy endpoints for backward compatibility
- ✅ Pre-configured variables
- ✅ Example request bodies
- ✅ Organized by functionality
- ✅ Ready to use immediately

---

## 🆘 Troubleshooting

### Issue: Variables not working

**Solution:**
- Make sure variables are set at collection level
- Use `{{variable_name}}` syntax (double curly braces)
- Check variable scope (collection vs environment)

### Issue: Request fails

**Solution:**
- Verify `base_url` is correct: `http://localhost:8080`
- Check if API server is running: `curl http://localhost:8080/health`
- Check request body format (JSON)

### Issue: Discovery ID not found

**Solution:**
- Make sure discovery completed
- Check if you're using the correct endpoint (`/qa-buddy-v2/discover/{id}`)
- Verify discovery_id variable is set correctly

---

## 📚 Related Documentation

- [HOW_TO_USE.md](HOW_TO_USE.md) - Complete usage guide
- [QUICK_START.md](QUICK_START.md) - Quick start steps
- [README.md](README.md) - Overview
