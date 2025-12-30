# How to Build Docker Images

This guide explains how to build Docker images for FlowOps.

## Prerequisites

1. **Docker installed and running**
   - macOS/Windows: Install [Docker Desktop](https://www.docker.com/products/docker-desktop)
   - Linux: Install Docker Engine
   - Verify: `docker --version`

2. **Docker is running**
   - Check: `docker info`
   - Start Docker Desktop if needed

## Method 1: Using the Build Script (Easiest)

### Build Both Images

```bash
cd qa-pr-dashboard
./build-images.sh
```

This builds:
- `qa-pr-dashboard-frontend:latest`
- `qa-pr-dashboard-api:latest`

### Build with Custom Tag

```bash
TAG=v1.0.0 ./build-images.sh
```

### Build with Custom Registry

```bash
REGISTRY=your-registry.com/ ./build-images.sh
```

## Method 2: Manual Build Commands

### Build Frontend Image

```bash
cd qa-pr-dashboard
docker build -t qa-pr-dashboard-frontend:latest -f Dockerfile .
```

### Build API Image

```bash
cd qa-pr-dashboard
docker build -t qa-pr-dashboard-api:latest -f api-server/Dockerfile api-server/
```

### Build with Specific Tag

```bash
# Frontend
docker build -t qa-pr-dashboard-frontend:v1.0.0 -f Dockerfile .

# API
docker build -t qa-pr-dashboard-api:v1.0.0 -f api-server/Dockerfile api-server/
```

## Method 3: Build for Docker Hub

### Build and Tag for Docker Hub

```bash
cd qa-pr-dashboard

# Build frontend with Docker Hub tag
docker build -t amitngm/qa-pr-dashboard-frontend:latest -f Dockerfile .

# Build API with Docker Hub tag
docker build -t amitngm/qa-pr-dashboard-api:latest -f api-server/Dockerfile api-server/
```

Replace `amitngm` with your Docker Hub username.

### Using the Build-and-Push Script

```bash
cd qa-pr-dashboard
./build-and-push.sh amitngm
```

This builds AND pushes to Docker Hub in one command.

## Verify Built Images

### List All Images

```bash
docker images | grep qa-pr-dashboard
```

### Check Image Details

```bash
docker inspect qa-pr-dashboard-frontend:latest
docker inspect qa-pr-dashboard-api:latest
```

## Test Images Locally

### Run Frontend

```bash
docker run -p 3000:3000 \
  -e API_URL=http://localhost:8000/api \
  qa-pr-dashboard-frontend:latest
```

### Run API

```bash
docker run -p 8000:8000 \
  -e MONGODB_URI=mongodb://localhost:27017 \
  -e DB_NAME=qa_pr_dashboard \
  qa-pr-dashboard-api:latest
```

### Run with Docker Compose

```bash
cd qa-pr-dashboard
docker-compose up -d
```

This starts frontend, API, and MongoDB together.

## Build Options

### Build Without Cache

```bash
docker build --no-cache -t qa-pr-dashboard-frontend:latest -f Dockerfile .
```

### Build with Build Arguments

```bash
docker build \
  --build-arg NODE_ENV=production \
  -t qa-pr-dashboard-frontend:latest \
  -f Dockerfile .
```

### Build for Specific Platform

```bash
docker build --platform linux/amd64 -t qa-pr-dashboard-frontend:latest -f Dockerfile .
```

## Troubleshooting

### Build Fails: "Cannot connect to Docker daemon"

**Solution**: Start Docker Desktop or Docker service
```bash
# macOS/Windows: Open Docker Desktop app
# Linux:
sudo systemctl start docker
```

### Build Fails: "Out of space"

**Solution**: Clean up Docker
```bash
docker system prune -a
```

### Build is Slow

**Solution**: 
- Use Docker BuildKit: `DOCKER_BUILDKIT=1 docker build ...`
- Check `.dockerignore` is excluding unnecessary files
- Use multi-stage builds (already implemented)

### Frontend Build Fails: "Module not found"

**Solution**: Ensure all dependencies are in `package.json`
```bash
cd qa-pr-dashboard
npm install
```

### API Build Fails: "Cannot find module"

**Solution**: Check `api-server/package.json` has all dependencies
```bash
cd qa-pr-dashboard/api-server
npm install
```

## Image Sizes

After building, check image sizes:
```bash
docker images qa-pr-dashboard-frontend qa-pr-dashboard-api
```

Expected sizes:
- Frontend: ~200-300 MB
- API: ~150-200 MB

## Next Steps

After building:

1. **Test locally**: Run with `docker-compose up`
2. **Push to registry**: Use `./build-and-push.sh <username>`
3. **Deploy with Helm**: Update `values.yaml` with your image tags
4. **Deploy to Kubernetes**: Use the Helm chart

## Quick Reference

```bash
# Build both images
./build-images.sh

# Build and push to Docker Hub
./build-and-push.sh amitngm

# Build with custom tag
TAG=v1.0.0 ./build-images.sh

# Test locally
docker-compose up -d

# View logs
docker-compose logs -f

# Stop containers
docker-compose down
```


