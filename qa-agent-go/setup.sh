#!/bin/bash
set -e

echo "🛡️  QA Buddy — First-time setup"
echo "================================="

# Check for Go
if ! command -v go &> /dev/null; then
    echo "❌ Go not found. Install Go 1.22+ from https://go.dev/dl"
    echo ""
    echo "macOS (Homebrew):  brew install go"
    echo "macOS (direct):    download from https://go.dev/dl"
    exit 1
fi

GO_VERSION=$(go version | awk '{print $3}' | sed 's/go//')
echo "✅ Go $GO_VERSION found"

# Download dependencies
echo ""
echo "📦 Downloading Go dependencies..."
go mod tidy

# Install Playwright browsers
echo ""
echo "🌐 Installing Playwright browsers..."
go run github.com/playwright-community/playwright-go/cmd/playwright@latest install chromium --with-deps

echo ""
echo "✅ Setup complete!"
echo ""
echo "Start QA Buddy:"
echo "  go run ./cmd/server/"
echo "  Then open: http://localhost:8080"
echo ""
echo "Or use make:"
echo "  make run"
