#!/bin/bash

# QA Agent Setup Script
# This script prepares the QA Agent for use

set -e

echo "🚀 QA Agent Setup"
echo "================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check Python
echo "📦 Checking Python..."
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
    echo -e "${GREEN}✅ Python $PYTHON_VERSION found${NC}"
else
    echo -e "${RED}❌ Python 3 not found. Please install Python 3.8+${NC}"
    exit 1
fi

# Check Node.js
echo "📦 Checking Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✅ Node.js $NODE_VERSION found${NC}"
else
    echo -e "${RED}❌ Node.js not found. Please install Node.js 18+${NC}"
    exit 1
fi

# Setup API
echo ""
echo "🔧 Setting up API..."
cd agent-api

# Create virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv .venv
fi

# Activate virtual environment
echo "Activating virtual environment..."
source .venv/bin/activate

# Install Python dependencies
echo "Installing Python dependencies..."
pip install --upgrade pip

# Check Python version - Python 3.14 has compatibility issues with some packages
PYTHON_MINOR=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
if [[ "$PYTHON_MINOR" == "3.14" ]]; then
    echo "⚠️  Python 3.14 detected. Some packages may have compatibility issues."
    echo "   Consider using Python 3.11 or 3.12 for better compatibility."
    echo "   Attempting installation anyway..."
fi

# Try to install requirements, but continue if some packages fail
pip install -r requirements.txt || {
    echo "⚠️  Some packages failed to install. Trying alternative approach..."
    # Install core packages first
    pip install fastapi uvicorn[standard] httpx playwright aiofiles python-dotenv || true
    # Try to install others individually
    pip install pydantic || pip install "pydantic>=2.0,<2.6" || true
    pip install kubernetes || true
    pip install pymongo || true
}

# Install Playwright
echo "Installing Playwright browser..."
playwright install chromium

# Create data directory
mkdir -p data
echo -e "${GREEN}✅ API setup complete${NC}"

# Setup UI
echo ""
echo "🔧 Setting up UI..."
cd ../ui

# Install Node dependencies
if [ ! -d "node_modules" ]; then
    echo "Installing Node.js dependencies..."
    npm install
else
    echo "Node modules already installed, skipping..."
fi

echo -e "${GREEN}✅ UI setup complete${NC}"

# Create .env file if it doesn't exist
cd ..
if [ ! -f ".env" ]; then
    echo ""
    echo "📝 Creating .env file..."
    cat > .env << EOF
# QA Agent Environment Variables
DATA_DIR=./agent-api/data
ALLOW_PROD=false
EOF
    echo -e "${GREEN}✅ .env file created${NC}"
fi

echo ""
echo "✅ Setup Complete!"
echo ""
echo "Next steps:"
echo "1. Start API:"
echo "   cd agent-api"
echo "   source .venv/bin/activate"
echo "   DATA_DIR=./data uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload"
echo ""
echo "2. Start UI (in another terminal):"
echo "   cd ui"
echo "   npm run dev"
echo ""
echo "3. Access:"
echo "   - UI: http://localhost:3000"
echo "   - API: http://localhost:8080"
echo "   - API Docs: http://localhost:8080/docs"
echo ""
