#!/bin/bash

# Build and push Docker images using Podman
# Usage: ./build-and-push-podman.sh [tag]

set -e

DOCKERHUB_USERNAME="amitngm"
TAG=${1:-latest}

FRONTEND_IMAGE="${DOCKERHUB_USERNAME}/qa-pr-dashboard-frontend"
API_IMAGE="${DOCKERHUB_USERNAME}/qa-pr-dashboard-api"

echo "🏗️  Building and pushing Docker images with Podman..."
echo "Docker Hub Username: ${DOCKERHUB_USERNAME}"
echo "Tag: ${TAG}"
echo ""

# Check if Podman is available
if ! command -v podman &> /dev/null; then
  echo "❌ Podman is not installed. Please install Podman first."
  exit 1
fi

# Check if Podman machine is running (for macOS/Windows)
if podman machine list 2>/dev/null | grep -q "running"; then
  echo "✅ Podman machine is running"
elif podman machine list 2>/dev/null | grep -q "stopped"; then
  echo "⚠️  Podman machine is stopped. Starting it..."
  podman machine start
  sleep 5
else
  echo "ℹ️  Podman machine not found or not applicable for this system"
fi

# Check if logged in to Docker Hub
echo "Checking Docker Hub login status..."
if ! podman login --get-login docker.io 2>/dev/null | grep -q "${DOCKERHUB_USERNAME}"; then
  echo "⚠️  Not logged in to Docker Hub. Please login:"
  podman login docker.io
fi

# Build frontend
echo ""
echo "📦 Building frontend image with Podman..."
podman build -t ${FRONTEND_IMAGE}:${TAG} -t ${FRONTEND_IMAGE}:latest -f Dockerfile .

# Build API
echo ""
echo "📦 Building API image with Podman..."
podman build -t ${API_IMAGE}:${TAG} -t ${API_IMAGE}:latest -f api-server/Dockerfile api-server/

# Push frontend
echo ""
echo "📤 Pushing frontend image to Docker Hub..."
podman push ${FRONTEND_IMAGE}:${TAG} docker://docker.io/${FRONTEND_IMAGE}:${TAG}
podman push ${FRONTEND_IMAGE}:latest docker://docker.io/${FRONTEND_IMAGE}:latest

# Push API
echo ""
echo "📤 Pushing API image to Docker Hub..."
podman push ${API_IMAGE}:${TAG} docker://docker.io/${API_IMAGE}:${TAG}
podman push ${API_IMAGE}:latest docker://docker.io/${API_IMAGE}:latest

echo ""
echo "✅ Successfully built and pushed images to Docker Hub!"
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
echo "   podman pull docker.io/${FRONTEND_IMAGE}:latest"
echo "   podman pull docker.io/${API_IMAGE}:latest"











