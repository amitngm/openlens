#!/bin/bash
# Show backend server logs and activity

cd "$(dirname "$0")"

echo "=========================================="
echo "QA Agent API - Backend Activity Monitor"
echo "=========================================="
echo ""

# Check if server is running
if ! lsof -ti:8080 > /dev/null 2>&1; then
    echo "❌ Server is not running on port 8080"
    echo "   Start it with: bash start_server.sh"
    exit 1
fi

echo "✅ Server is running on port 8080"
echo ""

# Show server process info
echo "📊 Server Process:"
ps aux | grep "uvicorn.*8080" | grep -v grep | head -1
echo ""

# Show recent API activity
echo "📝 Recent API Endpoints:"
echo "   - Root: http://localhost:8080/"
echo "   - API Docs: http://localhost:8080/docs"
echo "   - UI: http://localhost:8080/ui/"
echo "   - Runs: http://localhost:8080/runs"
echo ""

# Check for log files
if [ -f "server.log" ]; then
    echo "📄 Recent Server Logs (last 30 lines):"
    echo "----------------------------------------"
    tail -30 server.log
    echo ""
    echo "💡 To follow logs in real-time: tail -f server.log"
else
    echo "📄 No server.log file found"
    echo "   Server output is going to the terminal where it was started"
    echo ""
fi

# Show recent discovery artifacts
echo "📦 Recent Discovery Artifacts:"
if [ -d "data" ]; then
    find data -name "discovery.json" -type f -mtime -1 | head -5 | while read f; do
        run_id=$(basename $(dirname "$f"))
        echo "   - Run ID: $run_id"
        echo "     Path: $f"
        if [ -f "$(dirname "$f")/events.jsonl" ]; then
            event_count=$(wc -l < "$(dirname "$f")/events.jsonl" 2>/dev/null || echo "0")
            echo "     Events: $event_count lines"
        fi
    done
else
    echo "   No data directory found"
fi

echo ""
echo "🔍 Key Backend Logging Points:"
echo "   - Discovery start: '[run_id] Starting enhanced discovery'"
echo "   - Modal detection: '[run_id] Modal/dialog detected, exploring...'"
echo "   - Tab discovery: '[run_id] Found X tabs in modal'"
echo "   - Page discovery: '[run_id] Discovered new page via ...'"
echo "   - Discovery complete: '[run_id] Discovery completed: X pages, Y forms'"
echo ""
echo "💡 To see live logs, check the terminal where the server was started"
echo "   or use: tail -f server.log (if logging to file)"
