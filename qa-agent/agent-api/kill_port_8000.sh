#!/bin/bash
# Kill processes using port 8000

echo "Finding processes on port 8000..."

PIDS=$(lsof -ti:8000 2>/dev/null)

if [ -z "$PIDS" ]; then
    echo "✅ No processes found on port 8000"
    exit 0
fi

echo "Found processes: $PIDS"
echo "Killing processes..."

for PID in $PIDS; do
    echo "Killing process $PID..."
    kill -9 $PID 2>/dev/null
done

sleep 2

# Verify
REMAINING=$(lsof -ti:8000 2>/dev/null)
if [ -z "$REMAINING" ]; then
    echo "✅ Successfully killed all processes on port 8000"
    echo "Port 8000 is now free"
    exit 0
else
    echo "⚠️  Some processes may still be running: $REMAINING"
    echo "You may need to kill them manually: kill -9 $REMAINING"
    exit 1
fi
