# Docker Hub Deployment Guide

This guide explains how to build and push Docker images to Docker Hub.

## Prerequisites

1. Docker installed and running
2. Docker Hub account (create at https://hub.docker.com)
3. Docker Hub username

## Step 1: Login to Docker Hub

```bash
docker login
```

Enter your Docker Hub username and password when prompted.

## Step 2: Build and Push Images

### Option 1: Using the automated script (Recommended)

```bash
cd qa-pr-dashboard
./build-and-push.sh <your-dockerhub-username> [tag]
```

**Examples:**
```bash
# Build and push with 'latest' tag
./build-and-push.sh myusername

# Build and push with specific version tag
./build-and-push.sh myusername v1.0.0
```

### Option 2: Manual build and push

#### Build Images

```bash
cd qa-pr-dashboard

# Build frontend
docker build -t <your-username>/qa-pr-dashboard-frontend:latest -f Dockerfile .

# Build API
docker build -t <your-username>/qa-pr-dashboard-api:latest -f api-server/Dockerfile api-server/
```

#### Tag Images (optional, for versioning)

```bash
# Tag frontend
docker tag <your-username>/qa-pr-dashboard-frontend:latest <your-username>/qa-pr-dashboard-frontend:v1.0.0

# Tag API
docker tag <your-username>/qa-pr-dashboard-api:latest <your-username>/qa-pr-dashboard-api:v1.0.0
```

#### Push Images

```bash
# Push frontend
docker push <your-username>/qa-pr-dashboard-frontend:latest
docker push <your-username>/qa-pr-dashboard-frontend:v1.0.0

# Push API
docker push <your-username>/qa-pr-dashboard-api:latest
docker push <your-username>/qa-pr-dashboard-api:v1.0.0
```

## Step 3: Verify Images on Docker Hub

Visit your Docker Hub repositories:
- `https://hub.docker.com/r/<your-username>/qa-pr-dashboard-frontend`
- `https://hub.docker.com/r/<your-username>/qa-pr-dashboard-api`

## Using the Images

### Pull and Run Locally

```bash
# Pull images
docker pull <your-username>/qa-pr-dashboard-frontend:latest
docker pull <your-username>/qa-pr-dashboard-api:latest

# Run with docker-compose (update image names in docker-compose.yml)
docker-compose up -d
```

### Update Helm Chart

Update `helm/qa-pr-dashboard/values.yaml`:

```yaml
image:
  frontend:
    repository: <your-username>/qa-pr-dashboard-frontend
    pullPolicy: Always
    tag: "latest"
  api:
    repository: <your-username>/qa-pr-dashboard-api
    pullPolicy: Always
    tag: "latest"
```

Then deploy:
```bash
helm install qa-pr-dashboard ./helm/qa-pr-dashboard
```

## Troubleshooting

### Docker daemon not running

```bash
# Start Docker Desktop (macOS/Windows)
# Or start Docker service (Linux)
sudo systemctl start docker
```

### Permission denied

```bash
# Add user to docker group (Linux)
sudo usermod -aG docker $USER
# Log out and log back in
```

### Login issues

```bash
# Logout and login again
docker logout
docker login
```

### Build fails

- Ensure Docker daemon is running
- Check disk space: `docker system df`
- Clean up unused images: `docker system prune -a`

## Best Practices

1. **Use version tags** instead of always using `latest` in production
2. **Enable Docker Hub automated builds** by connecting your GitHub repository
3. **Use Docker Hub webhooks** to trigger deployments
4. **Set up image scanning** for security vulnerabilities
5. **Use private repositories** for sensitive applications

## Automated Builds on Docker Hub

1. Go to Docker Hub → Create Repository
2. Connect your GitHub account
3. Select your repository
4. Configure build rules:
   - Source: `/qa-pr-dashboard/Dockerfile`
   - Tag: `latest`
5. Save and trigger build

This will automatically build and push images when you push to GitHub!

