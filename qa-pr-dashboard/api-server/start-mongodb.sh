#!/bin/bash

# Script to start MongoDB for FlowOps

echo "🔍 Checking MongoDB installation..."

# Check if MongoDB is already running
if pgrep -f mongod > /dev/null; then
    echo "✅ MongoDB is already running"
    exit 0
fi

# Option 1: Try Homebrew MongoDB
if command -v brew &> /dev/null; then
    echo "📦 Checking for Homebrew MongoDB..."
    if brew services list | grep -q mongodb; then
        echo "🚀 Starting MongoDB via Homebrew..."
        brew services start mongodb-community@7.0 || brew services start mongodb-community
        sleep 3
        if pgrep -f mongod > /dev/null; then
            echo "✅ MongoDB started successfully via Homebrew"
            exit 0
        fi
    fi
fi

# Option 2: Try Docker
if command -v docker &> /dev/null; then
    echo "🐳 Checking for MongoDB Docker container..."
    if docker ps -a | grep -q mongodb; then
        echo "🚀 Starting MongoDB Docker container..."
        docker start mongodb
        sleep 3
        if docker ps | grep -q mongodb; then
            echo "✅ MongoDB started successfully via Docker"
            exit 0
        fi
    else
        echo "🐳 Creating and starting MongoDB Docker container..."
        docker run -d -p 27017:27017 --name mongodb mongo:latest
        sleep 5
        if docker ps | grep -q mongodb; then
            echo "✅ MongoDB started successfully via Docker"
            exit 0
        fi
    fi
fi

# Option 3: Try system MongoDB
if command -v mongod &> /dev/null; then
    echo "🚀 Starting MongoDB directly..."
    mongod --fork --logpath /tmp/mongod.log
    sleep 3
    if pgrep -f mongod > /dev/null; then
        echo "✅ MongoDB started successfully"
        exit 0
    fi
fi

echo "❌ Could not start MongoDB automatically"
echo "📖 Please install MongoDB manually:"
echo "   1. macOS: brew tap mongodb/brew && brew install mongodb-community@7.0"
echo "   2. Or use Docker: docker run -d -p 27017:27017 --name mongodb mongo:latest"
echo "   3. See MONGODB_SETUP.md for detailed instructions"
exit 1
