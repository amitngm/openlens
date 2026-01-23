# QA Buddy - Deployment Guide

## Current Status

✅ **QA Buddy is currently running!**

- **UI**: http://localhost:8000
- **API**: http://localhost:8000/docs
- **Status**: Native Python server (using .venv)

## Deployment Options

### Option 1: Native Python Server (Current - Recommended for Development)

**Advantages:**
- Fast startup
- Easy debugging
- Hot-reload enabled
- Direct file system access
- No container overhead

**Commands:**
```bash
# Start server
cd agent-api
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Or use the existing start script
./start_server.sh
```

**When to use:**
- Development and testing
- Local machine deployment
- Quick iterations

---

### Option 2: Docker Container (Production-Ready)

**Advantages:**
- Isolated environment
- Reproducible deployments
- Easy to share/distribute
- Runs anywhere Docker/Podman runs
- Includes all dependencies (Playwright, OCR, etc.)

**Files Created:**
- `Dockerfile` - Container definition
- `docker-compose.yml` - Multi-container orchestration
- `requirements.txt` - Python dependencies
- `start-docker-simple.sh` - Quick start script
- `.dockerignore` - Build optimization

**How to use:**

1. **Start Docker/Colima:**
   ```bash
   # Using Docker Desktop (Mac/Windows)
   # Start Docker Desktop application

   # OR using Colima (Mac alternative)
   colima start --cpu 2 --memory 4
   ```

2. **Build and run:**
   ```bash
   # Simple approach (no compose needed)
   ./start-docker-simple.sh

   # OR using docker-compose
   docker compose up -d

   # OR manual
   docker build -t qa-buddy .
   docker run -d -p 8000:8000 -v $(pwd)/data:/app/data qa-buddy
   ```

3. **Manage container:**
   ```bash
   # View logs
   docker logs -f qa-buddy-agent

   # Stop
   docker stop qa-buddy-agent

   # Restart
   docker restart qa-buddy-agent

   # Remove
   docker rm qa-buddy-agent
   ```

**When to use:**
- Production deployments
- Sharing with team
- Consistent environments
- CI/CD pipelines
- Cloud deployments (AWS, GCP, Azure)

---

### Option 3: Podman (Docker alternative)

Same as Docker but uses Podman:

1. **Start Podman machine:**
   ```bash
   podman machine init
   podman machine start
   ```

2. **Run:**
   ```bash
   ./start-podman.sh
   ```

**When to use:**
- Rootless containers preferred
- Docker not available
- Red Hat/Fedora systems

---

## Docker Troubleshooting

### Docker daemon not running

**Symptoms:**
```
Cannot connect to the Docker daemon
```

**Fix:**
```bash
# If using Docker Desktop
# Start the Docker Desktop application

# If using Colima
colima status  # Check status
colima start   # Start if stopped
colima restart # Restart if having issues
```

### Port already in use

**Symptoms:**
```
Error: port 8000 is already in use
```

**Fix:**
```bash
# Find and kill process on port 8000
lsof -ti:8000 | xargs kill -9

# Or change port in docker-compose.yml
ports:
  - "9000:8000"  # Use port 9000 instead
```

### Container won't start

**Check logs:**
```bash
docker logs qa-buddy-agent
```

**Common issues:**
- Missing dependencies → Rebuild: `docker build --no-cache -t qa-buddy .`
- Volume permissions → Add `:z` flag to volumes on SELinux systems
- Memory limits → Increase Docker memory allocation

---

## Production Recommendations

For production deployment:

1. **Use Docker/container deployment**
   - Consistent across environments
   - Easy to scale
   - Isolated dependencies

2. **Add PostgreSQL database** (from earlier recommendation)
   ```yaml
   # Add to docker-compose.yml
   services:
     postgres:
       image: postgres:15
       environment:
         POSTGRES_DB: qa_buddy
         POSTGRES_USER: qa_user
         POSTGRES_PASSWORD: ${DB_PASSWORD}
       volumes:
         - postgres_data:/var/lib/postgresql/data
   ```

3. **Add reverse proxy** (nginx/traefik for HTTPS)

4. **Use environment variables for secrets**
   ```bash
   # Create .env file
   DB_PASSWORD=secure_password
   SECRET_KEY=your_secret_key
   ```

5. **Set resource limits**
   ```yaml
   deploy:
     resources:
       limits:
         cpus: '2'
         memory: 4G
   ```

6. **Remove --reload flag** in Dockerfile for production

---

## Current Setup Summary

**What's running now:**
- Python virtual environment server
- Port 8000
- Hot-reload enabled
- Direct file system access

**Files created for Docker (ready when needed):**
- ✅ Dockerfile
- ✅ docker-compose.yml
- ✅ requirements.txt
- ✅ .dockerignore
- ✅ start-docker-simple.sh
- ✅ start-podman.sh
- ✅ DOCKER_README.md

**To switch to Docker:**
1. Stop current server
2. Fix Docker/Colima setup
3. Run `./start-docker-simple.sh`

---

## Quick Reference

| Task | Native | Docker |
|------|--------|--------|
| Start | `./start_server.sh` | `./start-docker-simple.sh` |
| Stop | Ctrl+C or kill process | `docker stop qa-buddy-agent` |
| Logs | Terminal output | `docker logs -f qa-buddy-agent` |
| Restart | Rerun script | `docker restart qa-buddy-agent` |
| Update code | Just save (hot-reload) | Rebuild image |

---

## Next Steps

1. **Continue with native server** (already working) for development
2. **Fix Docker/Colima** when ready for containerized deployment
3. **Add PostgreSQL database** for production data persistence
4. **Deploy to cloud** using container image

Your QA Buddy is fully functional right now! 🎉
