#!/bin/bash
# Kill process using port 8080

echo "Finding process on port 8080..."

PID=$(lsof -ti:8080 2>/dev/null)

if [ -z "$PID" ]; then
    echo "✅ No process found on port 8080"
    exit 0
fi

echo "Found process: $PID"
echo "Killing process..."

kill -9 $PID 2>/dev/null

sleep 1

# Verify
if lsof -ti:8080 > /dev/null 2>&1; then
    echo "⚠️  Process still running, trying force kill..."
    kill -9 $PID 2>/dev/null
    sleep 1
fi

if lsof -ti:8080 > /dev/null 2>&1; then
    echo "❌ Failed to kill process on port 8080"
    echo "Try manually: kill -9 $PID"
    exit 1
else
    echo "✅ Successfully killed process on port 8080"
    echo "Port 8080 is now free"
fi
