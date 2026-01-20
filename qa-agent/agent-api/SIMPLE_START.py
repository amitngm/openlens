#!/usr/bin/env python3
"""
Simple server starter - Run this with: python3 SIMPLE_START.py
This will show you all output in your terminal.
"""

import sys
import subprocess
import os

print("=" * 60)
print("Starting Interactive QA Buddy Server")
print("=" * 60)
print()

# Change to script directory
os.chdir(os.path.dirname(os.path.abspath(__file__)))
print(f"Working directory: {os.getcwd()}")
print()

# Check if uvicorn is installed
try:
    import uvicorn
    print("✅ uvicorn is installed")
except ImportError:
    print("❌ uvicorn not found. Installing...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "uvicorn", "fastapi"])
    import uvicorn
    print("✅ uvicorn installed")

print()
print("=" * 60)
print("Starting server on http://localhost:8080")
print("=" * 60)
print()
print("📱 Web UI: http://localhost:8080/ui/")
print("🔧 Health: http://localhost:8080/health")
print("📚 Docs: http://localhost:8080/docs")
print()
print("Press Ctrl+C to stop")
print("=" * 60)
print()

# Start server - this will show all output
uvicorn.run("app.main:app", host="0.0.0.0", port=8080, reload=True)
