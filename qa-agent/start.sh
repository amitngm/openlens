#!/bin/bash

# QA Agent Start Script
# Starts both API and UI servers

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🚀 Starting QA Agent Services"
echo "=============================="
echo ""

# Check if setup has been run
if [ ! -d "agent-api/.venv" ]; then
    echo -e "${YELLOW}⚠️  Setup not detected. Running setup first...${NC}"
    ./setup.sh
    echo ""
fi

# Start API
echo "🔧 Starting API server..."
cd agent-api

# Activate virtual environment
source .venv/bin/activate

# Create data directory
mkdir -p data

# Start API in background
echo -e "${GREEN}Starting API on http://localhost:8080${NC}"
DATA_DIR=./data ALLOW_PROD=false uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload > ../api.log 2>&1 &
API_PID=$!

echo "API PID: $API_PID"
echo "API logs: tail -f api.log"

# Wait a bit for API to start
sleep 3

# Check if API is running
if curl -s http://localhost:8080/health > /dev/null; then
    echo -e "${GREEN}✅ API is running${NC}"
else
    echo -e "${YELLOW}⚠️  API may still be starting...${NC}"
fi

# Start UI
echo ""
echo "🔧 Starting UI server..."
cd ../ui

# Start UI in background
echo -e "${GREEN}Starting UI on http://localhost:3000${NC}"
npm run dev > ../ui.log 2>&1 &
UI_PID=$!

echo "UI PID: $UI_PID"
echo "UI logs: tail -f ui.log"

# Wait a bit for UI to start
sleep 5

echo ""
echo "✅ Services Started!"
echo ""
echo "📊 Services:"
echo "   - API: http://localhost:8080 (PID: $API_PID)"
echo "   - UI:  http://localhost:3000 (PID: $UI_PID)"
echo "   - Docs: http://localhost:8080/docs"
echo ""
echo "📝 Logs:"
echo "   - API: tail -f api.log"
echo "   - UI:  tail -f ui.log"
echo ""
echo "🛑 To stop services:"
echo "   kill $API_PID $UI_PID"
echo "   or run: ./stop.sh"
echo ""

# Save PIDs to file
echo "$API_PID" > .api.pid
echo "$UI_PID" > .ui.pid
