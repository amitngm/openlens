#!/bin/bash
# Complete setup and run script

cd "$(dirname "$0")"

echo "=========================================="
echo "Setting Up and Starting Server"
echo "=========================================="
echo ""

# Create virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
    echo "✅ Virtual environment created"
else
    echo "✅ Virtual environment exists"
fi

# Activate virtual environment
echo ""
echo "Activating virtual environment..."
source .venv/bin/activate

# Install dependencies
echo ""
echo "Installing dependencies..."
pip install -q uvicorn fastapi playwright

# Install playwright browsers if needed
echo ""
echo "Installing Playwright browsers..."
playwright install chromium 2>/dev/null || echo "Playwright browsers already installed"

echo ""
echo "=========================================="
echo "Starting Server"
echo "=========================================="
echo ""
echo "📱 Web UI: http://localhost:8080/ui/"
echo "🔧 Health: http://localhost:8080/health"
echo "📚 Docs: http://localhost:8080/docs"
echo ""
echo "Press Ctrl+C to stop"
echo "=========================================="
echo ""

# Start server - you'll see all output
uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
