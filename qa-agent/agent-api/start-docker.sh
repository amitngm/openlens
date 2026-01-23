#!/bin/bash

# QA Buddy - Docker/Podman Start Script
# This script builds and starts the QA Buddy service using Docker or Podman

set -e

# Detect if we're using podman or docker
if command -v podman &> /dev/null; then
    CONTAINER_CMD="podman"
    COMPOSE_CMD="podman-compose"
    echo "✅ Using Podman"
elif command -v docker &> /dev/null; then
    CONTAINER_CMD="docker"
    COMPOSE_CMD="docker compose"
    echo "✅ Using Docker"
else
    echo "❌ Error: Neither Docker nor Podman found. Please install one of them."
    exit 1
fi

# Check if docker-compose/podman-compose is available
if ! command -v $COMPOSE_CMD &> /dev/null; then
    if [ "$CONTAINER_CMD" = "podman" ]; then
        echo "⚠️  podman-compose not found."
        if command -v brew &> /dev/null; then
            echo "📦 Installing podman-compose via brew..."
            brew install podman-compose
        else
            echo "❌ Error: podman-compose not found. Please install it:"
            echo "   brew install podman-compose"
            echo "   or: pipx install podman-compose"
            exit 1
        fi
    else
        echo "❌ Error: docker-compose not found. Please install it."
        exit 1
    fi
fi

echo ""
echo "🚀 Starting QA Buddy..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Navigate to script directory
cd "$(dirname "$0")"

# Stop any existing containers
echo "🛑 Stopping existing containers..."
$COMPOSE_CMD down 2>/dev/null || true

# Build the image
echo ""
echo "🔨 Building QA Buddy image..."
$COMPOSE_CMD build

# Start the service
echo ""
echo "▶️  Starting QA Buddy service..."
$COMPOSE_CMD up -d

# Wait for service to be ready
echo ""
echo "⏳ Waiting for service to be ready..."
for i in {1..30}; do
    if curl -s http://localhost:8000/runs/health > /dev/null 2>&1; then
        echo "✅ QA Buddy is ready!"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "⚠️  Service did not start within 30 seconds. Check logs with: $COMPOSE_CMD logs"
        exit 1
    fi
    sleep 1
    echo -n "."
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ QA Buddy is running!"
echo ""
echo "📍 Access the UI at: http://localhost:8000"
echo "📍 API docs at: http://localhost:8000/docs"
echo ""
echo "Useful commands:"
echo "  View logs:    $COMPOSE_CMD logs -f"
echo "  Stop service: $COMPOSE_CMD down"
echo "  Restart:      $COMPOSE_CMD restart"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
