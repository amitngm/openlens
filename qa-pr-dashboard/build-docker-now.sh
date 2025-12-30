#!/bin/bash

# Build Docker images for FlowOps
set -e

DOCKERHUB_USERNAME="amitngm"
TAG="latest"

FRONTEND_IMAGE="${DOCKERHUB_USERNAME}/qa-pr-dashboard-frontend"
API_IMAGE="${DOCKERHUB_USERNAME}/qa-pr-dashboard-api"

echo "🏗️  Building Docker images..."
echo "Docker Hub Username: ${DOCKERHUB_USERNAME}"
echo "Tag: ${TAG}"
echo ""

# Check if Docker is running
if ! docker ps > /dev/null 2>&1; then
  echo "❌ Docker is not running. Please start Docker Desktop or Colima first."
  exit 1
fi

# Build frontend
echo "📦 Building frontend image..."
docker build -t ${FRONTEND_IMAGE}:${TAG} -f Dockerfile .

# Build API
echo ""
echo "📦 Building API image..."
docker build -t ${API_IMAGE}:${TAG} -f api-server/Dockerfile api-server/

echo ""
echo "✅ Build complete!"
echo ""
echo "Images built:"
echo "  - ${FRONTEND_IMAGE}:${TAG}"
echo "  - ${API_IMAGE}:${TAG}"
echo ""
echo "To push to Docker Hub, run:"
echo "  docker login"
echo "  docker push ${FRONTEND_IMAGE}:${TAG}"
echo "  docker push ${API_IMAGE}:${TAG}"

