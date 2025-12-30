#!/bin/bash

# Build script for FlowOps Docker images

set -e

REGISTRY="${REGISTRY:-}"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-qa-pr-dashboard-frontend}"
API_IMAGE="${API_IMAGE:-qa-pr-dashboard-api}"
TAG="${TAG:-latest}"

echo "🏗️  Building Docker images..."
echo "Registry: ${REGISTRY:-'local'}"
echo "Frontend: ${FRONTEND_IMAGE}:${TAG}"
echo "API: ${API_IMAGE}:${TAG}"

# Build frontend
echo ""
echo "📦 Building frontend image..."
docker build -t ${REGISTRY}${FRONTEND_IMAGE}:${TAG} -f Dockerfile .

# Build API
echo ""
echo "📦 Building API image..."
docker build -t ${REGISTRY}${API_IMAGE}:${TAG} -f api-server/Dockerfile api-server/

echo ""
echo "✅ Build complete!"
echo ""
echo "To push to registry:"
echo "  docker push ${REGISTRY}${FRONTEND_IMAGE}:${TAG}"
echo "  docker push ${REGISTRY}${API_IMAGE}:${TAG}"

