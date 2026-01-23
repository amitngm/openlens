#!/bin/bash

# QA Buddy - Simple Podman Start Script
# This script builds and starts QA Buddy using Podman directly (no compose needed)

set -e

echo "🚀 Starting QA Buddy with Podman..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Navigate to script directory
cd "$(dirname "$0")"

# Container and image names
IMAGE_NAME="qa-buddy"
CONTAINER_NAME="qa-buddy-agent"

# Stop and remove existing container if it exists
if podman ps -a --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
    echo "🛑 Stopping existing container..."
    podman stop $CONTAINER_NAME 2>/dev/null || true
    podman rm $CONTAINER_NAME 2>/dev/null || true
fi

# Build the image
echo "🔨 Building QA Buddy image..."
podman build -t $IMAGE_NAME .

# Create data directory if it doesn't exist
mkdir -p ./data/temp_uploads/images

# Run the container
echo ""
echo "▶️  Starting QA Buddy container..."
podman run -d \
    --name $CONTAINER_NAME \
    -p 8000:8000 \
    -v "$(pwd)/data:/app/data:z" \
    -v "$(pwd)/app:/app/app:z" \
    -v "$(pwd)/ui:/app/ui:z" \
    -e PYTHONUNBUFFERED=1 \
    -e LOG_LEVEL=INFO \
    --restart unless-stopped \
    $IMAGE_NAME

# Wait for service to be ready
echo ""
echo "⏳ Waiting for service to be ready..."
for i in {1..30}; do
    if curl -s http://localhost:8000/runs/health > /dev/null 2>&1; then
        echo "✅ QA Buddy is ready!"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "⚠️  Service did not start within 30 seconds."
        echo "Check logs with: podman logs $CONTAINER_NAME"
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
echo "  View logs:       podman logs -f $CONTAINER_NAME"
echo "  Stop service:    podman stop $CONTAINER_NAME"
echo "  Remove service:  podman rm $CONTAINER_NAME"
echo "  Restart service: podman restart $CONTAINER_NAME"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
