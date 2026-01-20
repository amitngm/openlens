#!/bin/bash
# Check server status and start if needed

echo "=========================================="
echo "Checking Server Status"
echo "=========================================="
echo ""

# Check if server is running on 8080
if curl -s http://localhost:8080/health > /dev/null 2>&1; then
    echo "✅ Server is RUNNING on port 8080"
    echo ""
    echo "Access points:"
    echo "  - UI: http://localhost:8080/ui/"
    echo "  - Health: http://localhost:8080/health"
    echo "  - API Docs: http://localhost:8080/docs"
    echo ""
    
    # Test UI
    if curl -s http://localhost:8080/ui/ > /dev/null 2>&1; then
        echo "✅ UI is accessible"
    else
        echo "⚠️  UI endpoint not responding (server may need restart)"
    fi
else
    echo "❌ Server is NOT running on port 8080"
    echo ""
    echo "To start the server, run:"
    echo "  cd $(pwd)"
    echo "  source .venv/bin/activate"
    echo "  uvicorn app.main:app --reload --host 0.0.0.0 --port 8080"
    echo ""
fi

echo ""
echo "=========================================="
echo "Process Check"
echo "=========================================="
ps aux | grep "uvicorn.*app.main" | grep -v grep || echo "No uvicorn processes found"

echo ""
echo "=========================================="
echo "Port Check"
echo "=========================================="
lsof -i :8080 2>/dev/null | grep LISTEN || echo "Port 8080 is not in use"
