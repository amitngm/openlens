#!/bin/bash
# Start server with visible output

cd "$(dirname "$0")"

echo "=========================================="
echo "Starting Interactive QA Buddy Server"
echo "=========================================="
echo ""
echo "Working directory: $(pwd)"
echo ""

# Check if virtual environment exists
if [ -d ".venv" ]; then
    echo "Activating virtual environment..."
    source .venv/bin/activate
elif [ -d "venv" ]; then
    echo "Activating virtual environment..."
    source venv/bin/activate
else
    echo "⚠️  No virtual environment found"
fi

echo ""
echo "Starting server on http://localhost:8080"
echo "Press Ctrl+C to stop"
echo ""
echo "Access points:"
echo "  - Web UI: http://localhost:8080/ui/"
echo "  - API Health: http://localhost:8080/health"
echo "  - API Docs: http://localhost:8080/docs"
echo ""
echo "=========================================="
echo ""

# Start server (foreground so you can see output)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
