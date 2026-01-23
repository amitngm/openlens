#!/bin/bash
# Real-time backend activity monitor

cd "$(dirname "$0")"

echo "=========================================="
echo "QA Agent API - Real-time Backend Monitor"
echo "=========================================="
echo ""
echo "Monitoring backend activity..."
echo "Press Ctrl+C to stop"
echo ""
echo "----------------------------------------"
echo ""

# Check if server is running
if ! lsof -ti:8080 > /dev/null 2>&1; then
    echo "❌ Server is not running on port 8080"
    exit 1
fi

# Show recent discovery events from all runs
echo "📊 Recent Discovery Events (from events.jsonl files):"
echo ""

if [ -d "data" ]; then
    # Find most recent events.jsonl files and show last few events
    find data -name "events.jsonl" -type f -mtime -1 | sort -r | head -3 | while read events_file; do
        run_id=$(basename $(dirname "$events_file"))
        echo "Run ID: $run_id"
        echo "----------------------------------------"
        tail -10 "$events_file" | while IFS= read -r line; do
            if [ ! -z "$line" ]; then
                # Extract event type and key info
                event_type=$(echo "$line" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('type', 'unknown'))" 2>/dev/null || echo "unknown")
                timestamp=$(echo "$line" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('timestamp', ''))" 2>/dev/null || echo "")
                echo "  [$timestamp] $event_type"
            fi
        done
        echo ""
    done
else
    echo "No discovery data found"
fi

echo "💡 To see detailed logs, check the terminal where the server was started"
echo "   Server process: $(ps aux | grep 'uvicorn.*8080' | grep -v grep | awk '{print $2}' | head -1)"
