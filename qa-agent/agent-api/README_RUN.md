# How to Run the Server

## What I've Built

I created:
1. **API Server** - FastAPI backend at `app/main.py`
2. **Web UI** - Single HTML page at `ui/index.html`
3. **Both run together** - The API server serves the UI automatically

## Where Files Are

```
/Users/amitkumarnigam/Downloads/openlens/qa-agent/agent-api/
├── app/
│   └── main.py          ← API server code
├── ui/
│   └── index.html       ← Web UI
└── run_server.sh        ← Helper script
```

## How to Run (Simple Steps)

### Step 1: Open Your Terminal

Open Terminal app on your Mac.

### Step 2: Navigate to the Project

```bash
cd /Users/amitkumarnigam/Downloads/openlens/qa-agent/agent-api
```

### Step 3: Activate Virtual Environment

```bash
source .venv/bin/activate
```

### Step 4: Start the Server

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
```

### Step 5: You'll See Output Like:

```
INFO:     Uvicorn running on http://0.0.0.0:8080 (Press CTRL+C to quit)
INFO:     Started reloader process
INFO:     Started server process
INFO:     UI served from: /Users/amitkumarnigam/Downloads/openlens/qa-agent/agent-api/ui
INFO:     QA Agent API initialized
INFO:     Application startup complete.
```

### Step 6: Open in Browser

Open your browser and go to:
```
http://localhost:8080/ui/
```

## What I Cannot Do

I **cannot** run commands in YOUR terminal that you can see. I can only:
- Create files
- Run commands in a background process (you won't see the output)
- Give you instructions

## To See It Running

You **must** run the commands above in **YOUR own terminal** to see the server output.

## Quick Test

Once running, test in another terminal:

```bash
curl http://localhost:8080/health
```

Should return: `{"status":"healthy"}`

## Stop the Server

Press `Ctrl+C` in the terminal where it's running.
