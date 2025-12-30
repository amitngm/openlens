#!/bin/bash

# Quick build and push script for amitngm
# Usage: ./build-and-push-amitngm.sh [tag]

set -e

DOCKERHUB_USERNAME="amitngm"
TAG=${1:-latest}

FRONTEND_IMAGE="${DOCKERHUB_USERNAME}/qa-pr-dashboard-frontend"
API_IMAGE="${DOCKERHUB_USERNAME}/qa-pr-dashboard-api"

echo "🏗️  Building and pushing Docker images to Docker Hub..."
echo "Docker Hub Username: ${DOCKERHUB_USERNAME}"
echo "Tag: ${TAG}"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "❌ Docker is not running. Please start Docker Desktop first."
  exit 1
fi

# Check if logged in to Docker Hub
if ! docker info 2>/dev/null | grep -q "Username"; then
  echo "⚠️  Not logged in to Docker Hub. Please login first:"
  echo "   docker login"
  echo ""
  read -p "Press Enter after logging in, or Ctrl+C to cancel..."
fi

# Build frontend
echo "📦 Building frontend image..."
docker build -t ${FRONTEND_IMAGE}:${TAG} -t ${FRONTEND_IMAGE}:latest -f Dockerfile .

# Build API
echo ""
echo "📦 Building API image..."
docker build -t ${API_IMAGE}:${TAG} -t ${API_IMAGE}:latest -f api-server/Dockerfile api-server/

# Push frontend
echo ""
echo "📤 Pushing frontend image to Docker Hub..."
docker push ${FRONTEND_IMAGE}:${TAG}
docker push ${FRONTEND_IMAGE}:latest

# Push API
echo ""
echo "📤 Pushing API image to Docker Hub..."
docker push ${API_IMAGE}:${TAG}
docker push ${API_IMAGE}:latest

echo ""
echo "✅ Successfully pushed images to Docker Hub!"
echo ""
echo "Images:"
echo "  - ${FRONTEND_IMAGE}:${TAG}"
echo "  - ${FRONTEND_IMAGE}:latest"
echo "  - ${API_IMAGE}:${TAG}"
echo "  - ${API_IMAGE}:latest"
echo ""
echo "View on Docker Hub:"
echo "  https://hub.docker.com/r/${DOCKERHUB_USERNAME}/qa-pr-dashboard-frontend"
echo "  https://hub.docker.com/r/${DOCKERHUB_USERNAME}/qa-pr-dashboard-api"
echo ""
echo "📢 Images are PUBLIC by default on Docker Hub (free accounts)"
echo "   Anyone can pull them using:"
echo "   docker pull ${FRONTEND_IMAGE}:latest"
echo "   docker pull ${API_IMAGE}:latest"

