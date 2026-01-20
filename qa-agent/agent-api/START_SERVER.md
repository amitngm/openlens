# Starting the Server

## Quick Start

The server runs both the API and UI together. Start it with:

```bash
cd qa-agent/agent-api
source .venv/bin/activate  # if using virtual environment
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Access Points

Once the server is running:

### Web UI
```
http://localhost:8000/ui/
```

### API Endpoints
- **Health Check**: `http://localhost:8000/health`
- **API Documentation**: `http://localhost:8000/docs`
- **Start Run**: `POST http://localhost:8000/runs/start`
- **Get Status**: `GET http://localhost:8000/runs/{run_id}/status`
- **Answer Question**: `POST http://localhost:8000/runs/{run_id}/answer`
- **Get Report**: `GET http://localhost:8000/runs/{run_id}/report`

## Verify Server is Running

```bash
# Check health
curl http://localhost:8000/health

# Check UI
curl http://localhost:8000/ui/

# Open in browser (macOS)
open http://localhost:8000/ui/
```

## Troubleshooting

### Port Already in Use

If port 8000 is already in use:

```bash
# Use a different port
uvicorn app.main:app --reload --host 0.0.0.0 --port 8001

# Then access UI at: http://localhost:8001/ui/
```

### Server Won't Start

1. Check Python version: `python3 --version` (needs 3.8+)
2. Install dependencies: `pip install -r requirements.txt`
3. Check for errors in terminal output

### UI Not Loading

1. Verify UI file exists: `ls qa-agent/agent-api/ui/index.html`
2. Check server logs for errors
3. Verify static file serving in `app/main.py`

## Background Process

To run in background:

```bash
nohup uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 > server.log 2>&1 &
```

To stop:
```bash
pkill -f "uvicorn app.main:app"
```
