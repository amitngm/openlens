# 🚀 QA Buddy - Quick Start Guide

## ✅ Current Status

Your QA Buddy server is **already running** on port 8000!

- **UI**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs
- **Status**: Native Python server (development mode)

---

## 🎯 Option 1: Use Current Server (Recommended)

The server is already running and fully functional. No action needed!

```bash
# Just open in your browser
open http://localhost:8000
```

---

## 🐳 Option 2: Run in Docker Container

If you want to run QA Buddy in a Docker container instead:

### Step 1: Start Docker Runtime

```bash
# Check if Colima is running
colima status

# If not running, start it
colima start --cpu 2 --memory 4 --disk 10

# Wait for it to fully start (takes 20-30 seconds)
```

### Step 2: Stop Current Server

```bash
# Find the process
lsof -ti:8000

# Kill it
lsof -ti:8000 | xargs kill -9
```

### Step 3: Start Docker Container

```bash
# Simple one-command start
./start-docker-simple.sh
```

This will:
- Build the QA Buddy Docker image (~2-3 minutes first time)
- Start the container
- Wait for service to be ready
- Show you the access URLs

---

## 📋 Docker Quick Commands

Once Docker is running:

```bash
# View logs
docker logs -f qa-buddy-agent

# Stop container
docker stop qa-buddy-agent

# Start container (after stopping)
docker start qa-buddy-agent

# Restart container
docker restart qa-buddy-agent

# Remove container (to rebuild)
docker rm -f qa-buddy-agent
```

---

## 🔧 Troubleshooting

### Colima won't start

```bash
# Check what's wrong
colima status

# Try deleting and recreating
colima delete
colima start --cpu 2 --memory 4
```

### Port 8000 already in use

```bash
# Find what's using it
lsof -ti:8000

# Kill the process
lsof -ti:8000 | xargs kill -9
```

### Docker build fails

```bash
# Clean build
docker system prune -a
docker build --no-cache -t qa-buddy .
```

---

## 🎉 You're All Set!

**Current setup**: Native Python server running perfectly ✅

**Docker files**: Created and ready when you need them 📦

**Next steps**:
1. Use http://localhost:8000 to access QA Buddy
2. Upload images and start discovery runs
3. Switch to Docker later if needed for production

---

## 📊 Comparison

| Feature | Native Server | Docker Container |
|---------|--------------|------------------|
| **Speed** | Fastest | Slightly slower |
| **Setup** | Already done ✅ | Need to start Colima |
| **Hot reload** | Yes | Yes (with volumes) |
| **Isolation** | No | Yes |
| **Production** | Development only | Production ready |
| **Sharing** | Need Python setup | Just share image |

**Recommendation**: Keep using the native server for now. It's perfect for development!
