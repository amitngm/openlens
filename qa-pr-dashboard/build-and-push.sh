#!/bin/bash

# Build and push Docker images to Docker Hub
# Usage: ./build-and-push.sh <dockerhub-username> [tag]

set -e

if [ -z "$1" ]; then
  echo "❌ Error: Docker Hub username required"
  echo "Usage: ./build-and-push.sh <dockerhub-username> [tag]"
  echo "Example: ./build-and-push.sh myusername v1.0.0"
  exit 1
fi

DOCKERHUB_USERNAME=$1
TAG=${2:-latest}

FRONTEND_IMAGE="${DOCKERHUB_USERNAME}/qa-pr-dashboard-frontend"
API_IMAGE="${DOCKERHUB_USERNAME}/qa-pr-dashboard-api"

echo "🏗️  Building and pushing Docker images to Docker Hub..."
echo "Docker Hub Username: ${DOCKERHUB_USERNAME}"
echo "Tag: ${TAG}"
echo ""

# Check if logged in to Docker Hub
if ! docker info | grep -q "Username"; then
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
echo "📢 Making Images Public:"
echo "  Docker Hub repositories are PUBLIC by default (free accounts)."
echo "  To verify/change visibility:"
echo "  1. Go to https://hub.docker.com/r/${DOCKERHUB_USERNAME}/qa-pr-dashboard-frontend/settings"
echo "  2. Go to https://hub.docker.com/r/${DOCKERHUB_USERNAME}/qa-pr-dashboard-api/settings"
echo "  3. Ensure 'Public' is selected under 'Repository Visibility'"
echo ""
echo "  Or use Docker Hub CLI:"
echo "    docker hub repo update ${DOCKERHUB_USERNAME}/qa-pr-dashboard-frontend --visibility public"
echo "    docker hub repo update ${DOCKERHUB_USERNAME}/qa-pr-dashboard-api --visibility public"

