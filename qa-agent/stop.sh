#!/bin/bash

# QA Agent Stop Script
# Stops both API and UI servers

echo "🛑 Stopping QA Agent Services"
echo "============================="
echo ""

# Stop API
if [ -f ".api.pid" ]; then
    API_PID=$(cat .api.pid)
    if ps -p $API_PID > /dev/null 2>&1; then
        echo "Stopping API (PID: $API_PID)..."
        kill $API_PID
        rm .api.pid
        echo "✅ API stopped"
    else
        echo "API process not found"
        rm .api.pid
    fi
else
    # Try to find and kill uvicorn process
    UVICORN_PID=$(lsof -ti:8080 2>/dev/null || true)
    if [ ! -z "$UVICORN_PID" ]; then
        echo "Stopping API on port 8080 (PID: $UVICORN_PID)..."
        kill $UVICORN_PID
        echo "✅ API stopped"
    else
        echo "No API process found"
    fi
fi

# Stop UI
if [ -f ".ui.pid" ]; then
    UI_PID=$(cat .ui.pid)
    if ps -p $UI_PID > /dev/null 2>&1; then
        echo "Stopping UI (PID: $UI_PID)..."
        kill $UI_PID
        rm .ui.pid
        echo "✅ UI stopped"
    else
        echo "UI process not found"
        rm .ui.pid
    fi
else
    # Try to find and kill Next.js process
    NEXTJS_PID=$(lsof -ti:3000 2>/dev/null || true)
    if [ ! -z "$NEXTJS_PID" ]; then
        echo "Stopping UI on port 3000 (PID: $NEXTJS_PID)..."
        kill $NEXTJS_PID
        echo "✅ UI stopped"
    else
        echo "No UI process found"
    fi
fi

echo ""
echo "✅ All services stopped"
