#!/bin/bash
# Simple script to start the server - RUN THIS IN YOUR TERMINAL

cd "$(dirname "$0")"

echo "=========================================="
echo "Starting Interactive QA Buddy"
echo "=========================================="
echo ""

# Try to find and activate virtual environment
if [ -f ".venv/bin/activate" ]; then
    echo "Activating .venv..."
    source .venv/bin/activate
elif [ -f "venv/bin/activate" ]; then
    echo "Activating venv..."
    source venv/bin/activate
else
    echo "⚠️  No virtual environment found"
    echo "Installing dependencies..."
    python3 -m pip install uvicorn fastapi playwright
fi

echo ""
echo "Starting server..."
echo "You will see output below:"
echo ""

# Start server - you'll see all output
python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
