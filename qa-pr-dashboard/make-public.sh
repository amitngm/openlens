#!/bin/bash

# Script to make Docker Hub repositories public
# Usage: ./make-public.sh <dockerhub-username>

set -e

if [ -z "$1" ]; then
  echo "❌ Error: Docker Hub username required"
  echo "Usage: ./make-public.sh <dockerhub-username>"
  echo "Example: ./make-public.sh myusername"
  exit 1
fi

DOCKERHUB_USERNAME=$1

echo "🔓 Making Docker Hub repositories public..."
echo "Docker Hub Username: ${DOCKERHUB_USERNAME}"
echo ""

# Check if docker hub CLI is available
if command -v docker &> /dev/null; then
  echo "Using Docker Hub CLI..."
  
  # Make frontend public
  echo "Making qa-pr-dashboard-frontend public..."
  docker hub repo update ${DOCKERHUB_USERNAME}/qa-pr-dashboard-frontend --visibility public 2>/dev/null || {
    echo "⚠️  Could not update via CLI. Please update manually:"
    echo "   https://hub.docker.com/r/${DOCKERHUB_USERNAME}/qa-pr-dashboard-frontend/settings"
  }
  
  # Make API public
  echo "Making qa-pr-dashboard-api public..."
  docker hub repo update ${DOCKERHUB_USERNAME}/qa-pr-dashboard-api --visibility public 2>/dev/null || {
    echo "⚠️  Could not update via CLI. Please update manually:"
    echo "   https://hub.docker.com/r/${DOCKERHUB_USERNAME}/qa-pr-dashboard-api/settings"
  }
else
  echo "⚠️  Docker Hub CLI not available. Please update manually via web interface:"
  echo ""
  echo "Frontend:"
  echo "  https://hub.docker.com/r/${DOCKERHUB_USERNAME}/qa-pr-dashboard-frontend/settings"
  echo ""
  echo "API:"
  echo "  https://hub.docker.com/r/${DOCKERHUB_USERNAME}/qa-pr-dashboard-api/settings"
  echo ""
  echo "Steps:"
  echo "  1. Go to each repository's Settings page"
  echo "  2. Find 'Repository Visibility' section"
  echo "  3. Select 'Public'"
  echo "  4. Click 'Update'"
fi

echo ""
echo "✅ Public visibility instructions provided!"
echo ""
echo "Note: Docker Hub repositories are PUBLIC by default on free accounts."
echo "If you see 'Private', you may need to upgrade to a paid plan or the"
echo "repositories were explicitly set to private."

