# Backend Activity Monitoring

## Quick Start

### View Current Status
```bash
bash show_backend_logs.sh
```

### Monitor Real-time Activity
```bash
bash monitor_backend.sh
```

## What's Happening on the Backend

### 1. **Server Status**
- **Port**: 8080
- **Process**: Uvicorn with auto-reload
- **Logging**: JSON format to stdout/stderr

### 2. **Key Backend Activities**

#### **Discovery Process**
When a discovery run starts, the backend logs:

1. **Discovery Start**
   ```
   [run_id] Starting enhanced discovery from: <base_url>
   ```

2. **Dropdown Discovery**
   ```
   [run_id] Discovering top dropdowns/context selectors
   ```

3. **Navigation Discovery**
   ```
   [run_id] Discovering sidebar navigation
   ```

4. **Modal Detection** (when clicking elements)
   ```
   [run_id] Modal/dialog detected, exploring...
   [run_id] Found X tabs in modal
   ```

5. **Tab Exploration** (in modals)
   - Clicks each tab
   - Extracts forms from each tab
   - Extracts tables from each tab

6. **Page Discovery**
   ```
   [run_id] Discovered new page via <element_type> click: <url>
   [run_id] Discovered new SPA view via <element_type> click: <heading>
   ```

7. **Discovery Complete**
   ```
   [run_id] Discovery completed: X pages, Y forms, Z APIs
   [run_id] Added N forms from modals
   ```

### 3. **Event Streaming**

The backend streams events to `events.jsonl` files:

- **Event Types**:
  - `page_discovered` - New page found
  - `modal_discovered` - Modal opened and explored
  - `navigation_discovered` - Navigation items found
  - `dropdowns_discovered` - Context selectors found
  - `discovery_completed` - Discovery finished

### 4. **API Endpoints Activity**

- `POST /runs/start` - Starts new discovery run
- `GET /runs/{run_id}/status` - Gets current state
- `POST /runs/{run_id}/answer` - Processes user answers
- `GET /runs/{run_id}/events` - Streams discovery events
- `GET /runs/{run_id}/report` - Gets HTML report

### 5. **State Transitions**

The backend manages these states:
- `SESSION_CHECK` → `LOGIN_DETECT` → `LOGIN_ATTEMPT` → `POST_LOGIN_VALIDATE`
- → `CONTEXT_DETECT` → `DISCOVERY_RUN` → `DISCOVERY_SUMMARY`
- → `WAIT_TEST_INTENT` → `TEST_PLAN_BUILD` → `TEST_EXECUTE` → `REPORT_GENERATE` → `DONE`

## Viewing Logs

### Option 1: Terminal Output
If you started the server in a terminal, logs appear there in real-time.

### Option 2: Check Log Files
```bash
tail -f server.log  # If logging to file
```

### Option 3: Check Discovery Artifacts
```bash
# View events from a specific run
cat data/<run_id>/events.jsonl | jq '.'

# View discovery results
cat data/<run_id>/discovery.json | jq '.summary'

# View app map
cat data/<run_id>/discovery_appmap.json | jq '.'
```

### Option 4: API Health Check
```bash
curl http://localhost:8080/health
```

## Debug Mode

When `discovery_debug=true`:
- Forces headed browser (visible)
- Adds 200ms delay between actions
- Records video to `artifacts/<run_id>/video/`
- Writes detailed trace to `discovery_trace.jsonl`
- Takes screenshots before/after each action

## Key Files

- **Logs**: `server.log` (if configured) or terminal output
- **Events**: `data/<run_id>/events.jsonl`
- **Trace**: `data/<run_id>/discovery_trace.jsonl` (debug mode)
- **Results**: `data/<run_id>/discovery.json`
- **App Map**: `data/<run_id>/discovery_appmap.json`
