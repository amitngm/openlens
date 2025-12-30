#!/bin/bash

# Quick Start Script for Flow Tracing
# This script helps you enable flow tracing step by step

set -e

echo "🚀 Flow Tracing Quick Start"
echo "============================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check Node.js
echo "1️⃣  Checking Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "   ${GREEN}✅ Node.js installed: $NODE_VERSION${NC}"
else
    echo -e "   ${RED}❌ Node.js not installed${NC}"
    echo "   Please install from: https://nodejs.org/"
    exit 1
fi

# Check Docker
echo ""
echo "2️⃣  Checking Docker..."
if command -v docker &> /dev/null; then
    if docker ps &> /dev/null; then
        echo -e "   ${GREEN}✅ Docker is running${NC}"
        DOCKER_AVAILABLE=true
    else
        echo -e "   ${YELLOW}⚠️  Docker installed but not running${NC}"
        DOCKER_AVAILABLE=false
    fi
else
    echo -e "   ${YELLOW}⚠️  Docker not installed (optional)${NC}"
    DOCKER_AVAILABLE=false
fi

# Navigate to project
cd "$(dirname "$0")"
PROJECT_DIR=$(pwd)

# Check if .env exists
echo ""
echo "3️⃣  Checking API server configuration..."
cd "$PROJECT_DIR/api-server"
if [ -f ".env" ]; then
    echo -e "   ${GREEN}✅ .env file exists${NC}"
    
    # Check if tracing is enabled
    if grep -q "TRACING_ENABLED=true" .env 2>/dev/null; then
        echo -e "   ${GREEN}✅ Tracing is enabled${NC}"
    else
        echo -e "   ${YELLOW}⚠️  Tracing may not be enabled in .env${NC}"
    fi
else
    echo -e "   ${YELLOW}⚠️  .env file not found${NC}"
    echo "   Creating .env file..."
    cat > .env << 'EOF'
# API Server Configuration
PORT=8000

# OpenTelemetry Tracing Configuration
TRACING_ENABLED=true
TRACING_SERVICE_NAME=qa-pr-dashboard-api
TRACING_EXPORTER=jaeger
JAEGER_ENDPOINT=http://localhost:4318/v1/traces

# Trace Collector Configuration
TRACE_COLLECTOR_ENABLED=true
TRACE_COLLECTOR_INTERVAL=30000
TRACING_BACKEND=jaeger
JAEGER_API_URL=http://localhost:16686
EOF
    echo -e "   ${GREEN}✅ Created .env file${NC}"
fi

# Check dependencies
echo ""
echo "4️⃣  Checking dependencies..."
if [ -d "node_modules" ]; then
    echo -e "   ${GREEN}✅ Dependencies installed${NC}"
else
    echo -e "   ${YELLOW}⚠️  Installing dependencies...${NC}"
    npm install
    echo -e "   ${GREEN}✅ Dependencies installed${NC}"
fi

# Start Docker services (if available)
if [ "$DOCKER_AVAILABLE" = true ]; then
    echo ""
    echo "5️⃣  Starting Docker services (Jaeger/Tempo)..."
    cd "$PROJECT_DIR"
    
    # Try new docker compose syntax
    if docker compose version &> /dev/null; then
        docker compose -f docker-compose.tracing.yml up -d 2>/dev/null || true
    else
        docker-compose -f docker-compose.tracing.yml up -d 2>/dev/null || true
    fi
    
    sleep 3
    
    if docker ps | grep -q "jaeger\|tempo"; then
        echo -e "   ${GREEN}✅ Docker services started${NC}"
        echo "   Jaeger UI: http://localhost:16686"
    else
        echo -e "   ${YELLOW}⚠️  Docker services may not have started${NC}"
    fi
else
    echo ""
    echo "5️⃣  Skipping Docker services (not available)"
    echo -e "   ${YELLOW}⚠️  Trace collection will be disabled until backend is available${NC}"
fi

# Check if API server is running
echo ""
echo "6️⃣  Checking API server..."
if curl -s http://localhost:8000/api/health > /dev/null 2>&1; then
    echo -e "   ${GREEN}✅ API server is running${NC}"
    API_RUNNING=true
else
    echo -e "   ${YELLOW}⚠️  API server is not running${NC}"
    API_RUNNING=false
fi

# Summary
echo ""
echo "============================"
echo "📋 Summary"
echo "============================"
echo ""

if [ "$API_RUNNING" = false ]; then
    echo -e "${YELLOW}⚠️  Next Steps:${NC}"
    echo ""
    echo "1. Start API server:"
    echo "   cd $PROJECT_DIR/api-server"
    echo "   npm run dev"
    echo ""
    echo "2. In a new terminal, start frontend:"
    echo "   cd $PROJECT_DIR"
    echo "   npm run dev"
    echo ""
    echo "3. Open browser:"
    echo "   http://localhost:3000"
    echo ""
else
    echo -e "${GREEN}✅ Setup complete!${NC}"
    echo ""
    echo "📊 Access Points:"
    echo "   - API Server: http://localhost:8000"
    echo "   - Frontend: http://localhost:3000"
    if [ "$DOCKER_AVAILABLE" = true ]; then
        echo "   - Jaeger UI: http://localhost:16686"
    fi
    echo ""
    echo "📖 Full guide: STEP_BY_STEP_ENABLE_TRACING.md"
fi

echo ""
echo "🎉 Done!"

