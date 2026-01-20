#!/bin/bash
# Run API and UI server with visible output

cd "$(dirname "$0")"

echo "=========================================="
echo "Starting Interactive QA Buddy Server"
echo "=========================================="
echo ""
echo "Working directory: $(pwd)"
echo ""

# Activate virtual environment
if [ -d ".venv" ]; then
    echo "Activating virtual environment..."
    source .venv/bin/activate
    echo "✅ Virtual environment activated"
elif [ -d "venv" ]; then
    echo "Activating virtual environment..."
    source venv/bin/activate
    echo "✅ Virtual environment activated"
else
    echo "⚠️  No virtual environment found, using system Python"
fi

echo ""
echo "Checking for uvicorn..."
if ! command -v uvicorn &> /dev/null; then
    echo "❌ uvicorn not found!"
    echo "Installing dependencies..."
    pip install uvicorn fastapi
fi

echo ""
echo "=========================================="
echo "Starting Server on http://localhost:8080"
echo "=========================================="
echo ""
echo "📱 Web UI will be at: http://localhost:8080/ui/"
echo "🔧 API Health: http://localhost:8080/health"
echo "📚 API Docs: http://localhost:8080/docs"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""
echo "=========================================="
echo ""

# Start server (foreground - you'll see all output)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
