# MongoDB Setup Guide

## Option 1: Install MongoDB Locally (Recommended for Development)

### macOS (using Homebrew)

1. **Install MongoDB Community Edition:**
   ```bash
   brew tap mongodb/brew
   brew install mongodb-community
   ```

2. **Start MongoDB service:**
   ```bash
   brew services start mongodb-community
   ```

3. **Verify MongoDB is running:**
   ```bash
   brew services list | grep mongodb
   # Should show: mongodb-community started
   ```

4. **Test connection:**
   ```bash
   mongosh
   # Should connect successfully
   ```

### Linux

1. **Install MongoDB:**
   ```bash
   # Ubuntu/Debian
   wget -qO - https://www.mongodb.org/static/pgp/server-7.0.asc | sudo apt-key add -
   echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
   sudo apt-get update
   sudo apt-get install -y mongodb-org
   ```

2. **Start MongoDB:**
   ```bash
   sudo systemctl start mongod
   sudo systemctl enable mongod
   ```

### Windows

1. Download MongoDB Community Server from: https://www.mongodb.com/try/download/community
2. Run the installer
3. MongoDB will start automatically as a Windows service

## Option 2: Use MongoDB Atlas (Cloud - Free Tier Available)

1. **Sign up for MongoDB Atlas:** https://www.mongodb.com/cloud/atlas/register
2. **Create a free cluster**
3. **Get connection string:**
   - Click "Connect" on your cluster
   - Choose "Connect your application"
   - Copy the connection string
4. **Update environment variable:**
   ```bash
   export MONGODB_URI="mongodb+srv://username:password@cluster.mongodb.net/qa_pr_dashboard?retryWrites=true&w=majority"
   ```

## Option 3: Use Docker (Quick Setup)

1. **Run MongoDB in Docker:**
   ```bash
   docker run -d -p 27017:27017 --name mongodb mongo:latest
   ```

2. **Verify it's running:**
   ```bash
   docker ps | grep mongodb
   ```

## Configuration

After MongoDB is installed and running:

1. **Set environment variables (optional):**
   ```bash
   export MONGODB_URI="mongodb://localhost:27017"
   export DB_NAME="qa_pr_dashboard"
   ```

2. **Restart the API server:**
   ```bash
   cd api-server
   npm start
   ```

3. **Verify connection:**
   - Check server logs for: `✅ Connected to MongoDB`
   - If you see this, MongoDB is connected successfully!

## Troubleshooting

### Connection Refused Error

- **Check if MongoDB is running:**
  ```bash
  # macOS
  brew services list | grep mongodb
  
  # Linux
  sudo systemctl status mongod
  
  # Docker
  docker ps | grep mongodb
  ```

- **Check MongoDB logs:**
  ```bash
  # macOS
  tail -f /usr/local/var/log/mongodb/mongo.log
  
  # Linux
  sudo tail -f /var/log/mongodb/mongod.log
  ```

### Port Already in Use

If port 27017 is already in use:
- Find the process: `lsof -i :27017`
- Kill it: `kill -9 <PID>`
- Or change MongoDB port in configuration

### Permission Issues

- Ensure MongoDB has write permissions to its data directory
- Check MongoDB user permissions

## Current Status

The application will work **without MongoDB** using in-memory storage, but:
- ❌ Data is lost on server restart
- ❌ No persistence between sessions
- ❌ Limited scalability

With MongoDB:
- ✅ Data persists across restarts
- ✅ Multiple server instances can share data
- ✅ Better performance for large datasets
- ✅ Production-ready
