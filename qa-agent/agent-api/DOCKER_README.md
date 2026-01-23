# QA Buddy - Docker/Podman Deployment

This guide explains how to run QA Buddy using Docker or Podman containers.

## Quick Start

### Using the Start Script (Recommended)

```bash
./start-docker.sh
```

This script will:
- Auto-detect Docker or Podman
- Build the QA Buddy image
- Start the service
- Wait for it to be ready
- Display access URLs

### Manual Commands

#### Using Podman

```bash
# Build the image
podman-compose build

# Start the service
podman-compose up -d

# View logs
podman-compose logs -f

# Stop the service
podman-compose down
```

#### Using Docker

```bash
# Build the image
docker compose build

# Start the service
docker compose up -d

# View logs
docker compose logs -f

# Stop the service
docker compose down
```

## Accessing QA Buddy

Once started, access:
- **UI**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs
- **Health Check**: http://localhost:8000/runs/health

## Configuration

### Port Mapping

Default: `8000:8000` (host:container)

To change the host port, edit `docker-compose.yml`:
```yaml
ports:
  - "9000:8000"  # Access on port 9000
```

### Data Persistence

Discovery data, screenshots, and uploaded images are persisted in `./data/` directory, which is mounted as a volume.

### Environment Variables

Available environment variables:
- `LOG_LEVEL`: Set logging level (default: INFO)
- `PYTHONUNBUFFERED`: Python output buffering (default: 1)

## Development Mode

The container is configured for hot-reload. Changes to Python files will automatically restart the server.

## Troubleshooting

### Container won't start

Check logs:
```bash
podman-compose logs
# or
docker compose logs
```

### Port already in use

Change the host port in `docker-compose.yml` or stop the conflicting service:
```bash
lsof -ti:8000 | xargs kill -9
```

### Playwright browser issues

The Dockerfile installs Chromium with all dependencies. If browser automation fails:
```bash
# Rebuild the image
podman-compose build --no-cache
```

### Image analysis not working

The container includes:
- PIL/Pillow for image processing
- Tesseract OCR for text extraction

If OCR doesn't work, check container logs for Tesseract warnings.

## Image Size

The built image is approximately 1.5-2GB due to:
- Python base image (~150MB)
- Playwright + Chromium (~500MB)
- System dependencies (~200MB)
- Application code (~50MB)

## Production Deployment

For production use:

1. **Remove hot-reload**: Edit Dockerfile CMD to remove `--reload` flag
2. **Use secrets**: Don't commit credentials; use environment variables or secrets
3. **Add reverse proxy**: Use nginx or traefik for HTTPS
4. **Resource limits**: Add to docker-compose.yml:
   ```yaml
   deploy:
     resources:
       limits:
         cpus: '2'
         memory: 4G
   ```

## Database Integration

To add PostgreSQL (from recommendations):

1. Add to `docker-compose.yml`:
   ```yaml
   services:
     postgres:
       image: postgres:15
       environment:
         POSTGRES_DB: qa_buddy
         POSTGRES_USER: qa_user
         POSTGRES_PASSWORD: change_me
       volumes:
         - postgres_data:/var/lib/postgresql/data
       networks:
         - qa-buddy-network

   volumes:
     postgres_data:
   ```

2. Update `requirements.txt`:
   ```
   asyncpg==0.29.0
   sqlalchemy[asyncio]==2.0.23
   ```

3. Rebuild: `./start-docker.sh`

## Support

For issues, check:
- Container logs: `podman-compose logs -f`
- Health endpoint: `curl http://localhost:8000/runs/health`
- Application logs: `./data/*/events.jsonl`
