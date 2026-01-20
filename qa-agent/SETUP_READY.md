# QA Agent - Setup Status

## ✅ Setup Complete!

Your QA Agent is ready to use. Here's what's been set up:

### Prerequisites Check

- ✅ Python 3.14.0 installed
- ✅ Node.js v25.2.1 installed
- ✅ Virtual environment created
- ✅ Core dependencies installed

### Note on Python 3.14

Python 3.14 is very new and some packages (like `greenlet`, `pydantic-core`) may have compatibility issues. The core functionality should work, but if you encounter issues, consider using Python 3.11 or 3.12.

---

## 🚀 Quick Start

### Option 1: Use Start Script (Easiest)

```bash
./start.sh
```

This will start both API and UI automatically.

### Option 2: Manual Start

**Terminal 1 - API:**
```bash
cd agent-api
source .venv/bin/activate
DATA_DIR=./data uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
```

**Terminal 2 - UI:**
```bash
cd ui
npm run dev
```

### Option 3: Check if Already Running

```bash
# Check API
curl http://localhost:8080/health

# Check UI
curl http://localhost:3000
```

---

## 📋 Next Steps

1. **Start Services**: Use `./start.sh` or manual method above
2. **Verify**: 
   - API: http://localhost:8080/health
   - UI: http://localhost:3000
3. **Use QA Buddy V2**: See [QUICK_START.md](QUICK_START.md)

---

## 🔧 Troubleshooting

### If Setup Had Issues

**Python 3.14 Compatibility:**
- Some packages may not install on Python 3.14
- Core packages (fastapi, uvicorn, playwright) should work
- If needed, use Python 3.11 or 3.12:
  ```bash
  python3.11 -m venv agent-api/.venv
  # or
  python3.12 -m venv agent-api/.venv
  ```

**Re-run Setup:**
```bash
./setup.sh
```

**Check What's Installed:**
```bash
cd agent-api
source .venv/bin/activate
pip list | grep -E "(fastapi|playwright|uvicorn)"
```

---

## 📚 Documentation

- [QUICK_START.md](QUICK_START.md) - Step-by-step usage
- [README.md](README.md) - Overview
- [USAGE_GUIDE.md](USAGE_GUIDE.md) - Detailed guide
- [KEYCLOAK_FLOW.md](KEYCLOAK_FLOW.md) - Keycloak authentication

---

## ✅ Ready to Use!

Your setup is complete. Start the services and begin using QA Buddy V2!
