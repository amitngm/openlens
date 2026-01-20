# Interactive QA Buddy Web UI

## Overview

A simple, single-page web UI for the Interactive QA Buddy that provides an intuitive interface to:
- Start test runs with configuration
- Monitor run status and progress
- Answer interactive questions
- View test reports

## Accessing the UI

Once the server is running, access the UI at:

```
http://localhost:8000/ui/
```

Or directly:
```
http://localhost:8000/ui/index.html
```

## Features

### 1. Configuration Panel
- **Base URL**: Target application URL to test
- **Environment**: dev, staging, or production
- **Headless Mode**: Toggle browser visibility
- **Authentication**: Keycloak or None
- **Credentials**: Username and password (for Keycloak)

### 2. Status Panel
- **Run ID**: Unique identifier for the run
- **State**: Current state in the workflow
- **Current URL**: URL the browser is currently on
- **Last Step**: Most recent completed step
- **Progress**: Visual progress bar (0-100%)

### 3. Question Panel
Automatically appears when the backend needs user input:

- **Select One**: Clickable list of options (e.g., context selection, test intent)
- **Confirm**: Yes/No buttons (e.g., login confirmation)
- **Text**: Text input with submit button (e.g., credentials)

Screenshots are automatically displayed if available.

### 4. Report Panel
- **Open Report**: Opens HTML report in new tab
- **Show/Hide Report**: Toggles inline iframe view

## Usage Flow

1. **Configure**: Enter base URL and authentication details
2. **Start**: Click "Start Run" button
3. **Monitor**: Watch status panel for progress
4. **Answer**: Respond to questions as they appear
5. **Review**: Open report when run completes

## API Endpoints Used

The UI communicates with these backend endpoints:

- `POST /runs/start` - Start a new run
- `GET /runs/{run_id}/status` - Get run status (polled every 2 seconds)
- `POST /runs/{run_id}/answer` - Submit answer to question
- `GET /runs/{run_id}/report` - Get HTML report

## Configuration

The UI uses the same origin as the API by default. To use a different API host, edit the `API_BASE` constant in `index.html`:

```javascript
const API_BASE = 'http://localhost:8000'; // Change if needed
```

## Serving the UI

### Option 1: FastAPI Static Files (Recommended)

The UI is automatically served by FastAPI when you start the server:

```bash
cd qa-agent/agent-api
uvicorn app.main:app --reload
```

Access at: `http://localhost:8000/ui/`

### Option 2: Python HTTP Server (Development)

For standalone serving during development:

```bash
cd qa-agent/agent-api/ui
python3 -m http.server 8080
```

Then update `API_BASE` in `index.html` to point to your API server.

## CORS Configuration

The FastAPI server is configured with CORS to allow cross-origin requests. If serving the UI from a different origin, ensure CORS is properly configured in `app/main.py`.

## Example: Complete Workflow

1. Open `http://localhost:8000/ui/` in your browser
2. Enter:
   - Base URL: `https://your-app.example.com`
   - Environment: `dev`
   - Auth Type: `Keycloak`
   - Username: `testuser`
   - Password: `testpass`
3. Click "Start Run"
4. Watch the status panel update
5. When asked for context, click an option
6. When asked for test intent, select `smoke`
7. Wait for completion
8. Click "Open Report" to view results

## Troubleshooting

### UI not loading
- Check server is running: `curl http://localhost:8000/health`
- Verify UI files exist: `ls qa-agent/agent-api/ui/index.html`
- Check browser console for errors

### API calls failing
- Verify API_BASE in index.html matches your server
- Check CORS settings if using different origins
- Check browser network tab for request details

### Questions not appearing
- Check status endpoint: `curl http://localhost:8000/runs/{run_id}/status`
- Verify question object in response
- Check browser console for JavaScript errors

### Screenshots not loading
- Screenshots use relative paths from artifacts directory
- Ensure artifacts are accessible via the API
- Check screenshot_path in question object

## File Structure

```
qa-agent/agent-api/
├── ui/
│   └── index.html          # Single-page UI (HTML + CSS + JS)
└── app/
    └── main.py             # FastAPI app with static file serving
```

## Browser Compatibility

- Chrome/Edge: ✅ Fully supported
- Firefox: ✅ Fully supported
- Safari: ✅ Fully supported
- Mobile browsers: ✅ Responsive design

## No External Dependencies

The UI is completely self-contained:
- ✅ No React/Vue/Angular
- ✅ No external CSS frameworks (Bootstrap, etc.)
- ✅ No external JavaScript libraries
- ✅ Pure HTML, CSS, and vanilla JavaScript
- ✅ Works offline (after initial load)
