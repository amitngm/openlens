# Fix: UI Not Found Error

## Problem
Getting "detail not found" when accessing `http://localhost:8080/ui`

## Solution

The server on port 8080 is running an **old version** of the code that doesn't have UI static file serving. You need to restart it.

### Step 1: Stop the old server

```bash
# Find and kill the process
pkill -f "uvicorn.*8080"

# Or find the PID manually
ps aux | grep uvicorn | grep 8080
# Then kill it: kill <PID>
```

### Step 2: Start the server with updated code

```bash
cd /Users/amitkumarnigam/Downloads/openlens/qa-agent/agent-api

# Activate virtual environment
source .venv/bin/activate

# Start server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
```

### Step 3: Verify UI is accessible

```bash
# Check health
curl http://localhost:8080/health

# Check UI
curl http://localhost:8080/ui/

# Or open in browser
open http://localhost:8080/ui/
```

## What Changed

The updated `app/main.py` now includes:

```python
# Serve static UI files
ui_path = Path(__file__).parent.parent / "ui"
if ui_path.exists():
    app.mount("/ui", StaticFiles(directory=str(ui_path), html=True), name="ui")
```

This mounts the UI directory at `/ui` route.

## Quick Test

After restarting, you should see in the server logs:
```
UI served from: /path/to/qa-agent/agent-api/ui
```

And accessing `http://localhost:8080/ui/` should show the Interactive QA Buddy interface.
