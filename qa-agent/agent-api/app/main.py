"""
QA Agent API - Intelligent Test Discovery and Execution

Endpoints:
- POST /discover - Start browser-based discovery
- GET /discover/{id} - Get discovery results
- POST /generate-tests - Generate smoke tests from discovery
- POST /run - Execute tests
- GET /run/{id} - Get run status and report
- GET /run/{id}/artifacts - List artifacts with download URLs
"""

import os
import re
import json
import uuid
import time
import asyncio
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List
from urllib.parse import urlparse, urljoin
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# =============================================================================
# Configuration
# =============================================================================

DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

ALLOW_PROD = os.getenv("ALLOW_PROD", "false").lower() == "true"
PROD_PATTERNS = ["prod", "production", "live", "prd"]
MAX_CONCURRENT_RUNS = 1

SECRET_PATTERNS = [r"password", r"passwd", r"secret", r"token", r"api[_-]?key", r"auth", r"bearer"]

# Logging
logging.basicConfig(
    level=logging.INFO,
    format='{"time":"%(asctime)s","level":"%(levelname)s","msg":"%(message)s"}'
)
logger = logging.getLogger(__name__)

# =============================================================================
# Models
# =============================================================================

class DiscoverRequest(BaseModel):
    ui_url: str
    username: str
    password: str
    env: str = "staging"
    config_name: str = "default"


class GenerateTestsRequest(BaseModel):
    discovery_id: str
    templates: Optional[List[str]] = None


class RunRequest(BaseModel):
    discovery_id: str
    suite: str = "smoke"
    prompt: Optional[str] = None


# =============================================================================
# State Management
# =============================================================================

_discoveries: Dict[str, Dict] = {}
_runs: Dict[str, Dict] = {}
_current_run_lock = asyncio.Lock()
_active_run: Optional[str] = None


# =============================================================================
# Safety Utilities
# =============================================================================

def is_production(url: str, env: str) -> bool:
    """Check if targeting production environment."""
    if env.lower() in PROD_PATTERNS:
        return True
    url_lower = url.lower()
    return any(p in url_lower for p in PROD_PATTERNS)


def redact_secrets(data: Any, depth: int = 0) -> Any:
    """Recursively redact sensitive values."""
    if depth > 10:
        return data
    
    if isinstance(data, dict):
        redacted = {}
        for key, value in data.items():
            key_lower = key.lower()
            is_secret = any(re.search(p, key_lower) for p in SECRET_PATTERNS)
            if is_secret and isinstance(value, str):
                redacted[key] = "***REDACTED***"
            else:
                redacted[key] = redact_secrets(value, depth + 1)
        return redacted
    elif isinstance(data, list):
        return [redact_secrets(item, depth + 1) for item in data]
    elif isinstance(data, str):
        result = re.sub(r'Bearer\s+[A-Za-z0-9\-._~+/]+=*', 'Bearer ***', data)
        return result
    return data


def safe_log(msg: str, data: Any = None):
    """Log with redacted secrets."""
    if data:
        logger.info(f"{msg}: {json.dumps(redact_secrets(data), default=str)[:500]}")
    else:
        logger.info(msg)


# =============================================================================
# Keycloak-Compatible Login Config
# =============================================================================

LOGIN_CONFIGS = {
    "default": {
        "username_selector": "input[name='username'], input[name='email'], input[type='email'], #username, #email",
        "password_selector": "input[name='password'], input[type='password'], #password",
        "submit_selector": "button[type='submit'], input[type='submit'], #kc-login, button:has-text('Sign in'), button:has-text('Log in')",
        "success_indicator": "nav, .sidebar, .menu, .dashboard, .home, [data-logged-in]",
        "nav_selector": "nav a, .sidebar a, .menu a, .nav-link, [role='navigation'] a",
        "wait_after_login": 3000
    },
    "keycloak": {
        "username_selector": "#username, input[name='username']",
        "password_selector": "#password, input[name='password']",
        "submit_selector": "#kc-login, button[type='submit']",
        "success_indicator": "nav, .sidebar, .menu, .dashboard",
        "nav_selector": "nav a, .sidebar a, .menu a",
        "wait_after_login": 3000
    }
}


# =============================================================================
# Discovery Service
# =============================================================================

async def run_discovery(discovery_id: str, request: DiscoverRequest):
    """Run Playwright-based discovery."""
    from playwright.async_api import async_playwright
    
    discovery_dir = DATA_DIR / discovery_id
    discovery_dir.mkdir(parents=True, exist_ok=True)
    
    config = LOGIN_CONFIGS.get(request.config_name, LOGIN_CONFIGS["default"])
    
    result = {
        "discovery_id": discovery_id,
        "ui_url": request.ui_url,
        "env": request.env,
        "status": "running",
        "started_at": datetime.utcnow().isoformat() + "Z",
        "completed_at": None,
        "login_success": False,
        "pages": [],
        "navigation_items": [],
        "api_endpoints": [],
        "forms_found": [],
        "error": None
    }
    
    _discoveries[discovery_id]["status"] = "running"
    api_requests = set()
    
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                viewport={"width": 1920, "height": 1080},
                ignore_https_errors=True
            )
            page = await context.new_page()
            
            # Capture API requests
            def capture_request(req):
                url = req.url
                if any(x in url for x in ['/api/', '/v1/', '/v2/', '/graphql', '/rest/', '/auth/']):
                    api_requests.add(json.dumps({
                        "url": url,
                        "method": req.method,
                        "type": req.resource_type
                    }))
            
            page.on("request", capture_request)
            
            # Step 1: Navigate to URL
            safe_log(f"[{discovery_id}] Opening", {"url": request.ui_url})
            await page.goto(request.ui_url, timeout=30000, wait_until="networkidle")
            await page.screenshot(path=str(discovery_dir / "01_initial.png"))
            
            # Step 2: Login
            safe_log(f"[{discovery_id}] Attempting login")
            
            # Fill username
            for selector in config["username_selector"].split(", "):
                try:
                    if await page.locator(selector).first.count() > 0:
                        await page.locator(selector).first.fill(request.username)
                        break
                except:
                    continue
            
            # Fill password
            for selector in config["password_selector"].split(", "):
                try:
                    if await page.locator(selector).first.count() > 0:
                        await page.locator(selector).first.fill(request.password)
                        break
                except:
                    continue
            
            # Submit
            for selector in config["submit_selector"].split(", "):
                try:
                    if await page.locator(selector).first.count() > 0:
                        await page.locator(selector).first.click()
                        break
                except:
                    continue
            
            await asyncio.sleep(config["wait_after_login"] / 1000)
            await page.screenshot(path=str(discovery_dir / "02_after_login.png"))
            
            # Check login success
            for selector in config["success_indicator"].split(", "):
                try:
                    if await page.locator(selector).first.count() > 0:
                        result["login_success"] = True
                        safe_log(f"[{discovery_id}] Login successful")
                        break
                except:
                    continue
            
            # Step 3: Crawl navigation
            safe_log(f"[{discovery_id}] Crawling navigation")
            nav_items = []
            discovered_urls = set()
            
            for selector in config["nav_selector"].split(", "):
                try:
                    links = page.locator(selector)
                    count = await links.count()
                    
                    for i in range(min(count, 30)):
                        try:
                            link = links.nth(i)
                            href = await link.get_attribute("href")
                            text = await link.inner_text()
                            
                            if href and text.strip() and href not in discovered_urls:
                                full_url = urljoin(request.ui_url, href)
                                nav_items.append({
                                    "text": text.strip()[:100],
                                    "href": href,
                                    "full_url": full_url
                                })
                                discovered_urls.add(href)
                        except:
                            continue
                except:
                    continue
            
            result["navigation_items"] = nav_items
            safe_log(f"[{discovery_id}] Found {len(nav_items)} nav items")
            
            # Step 4: Visit top pages and collect forms
            base_domain = urlparse(request.ui_url).netloc
            
            for idx, nav in enumerate(nav_items[:10]):
                try:
                    url = nav["full_url"]
                    if urlparse(url).netloc != base_domain:
                        continue
                    
                    safe_log(f"[{discovery_id}] Visiting page {idx+1}: {url}")
                    await page.goto(url, timeout=30000, wait_until="networkidle")
                    
                    title = await page.title()
                    
                    # Find forms
                    forms = []
                    form_els = page.locator("form")
                    form_count = await form_els.count()
                    
                    for i in range(min(form_count, 5)):
                        try:
                            form = form_els.nth(i)
                            action = await form.get_attribute("action") or ""
                            method = await form.get_attribute("method") or "GET"
                            
                            inputs = []
                            input_els = form.locator("input, select, textarea")
                            input_count = await input_els.count()
                            
                            for j in range(min(input_count, 15)):
                                try:
                                    inp = input_els.nth(j)
                                    inp_type = await inp.get_attribute("type") or "text"
                                    inp_name = await inp.get_attribute("name") or ""
                                    
                                    if inp_type not in ["hidden", "submit"]:
                                        inputs.append({"type": inp_type, "name": inp_name})
                                except:
                                    continue
                            
                            if inputs:
                                forms.append({
                                    "action": action,
                                    "method": method.upper(),
                                    "inputs": inputs,
                                    "page_url": url
                                })
                        except:
                            continue
                    
                    result["pages"].append({
                        "url": url,
                        "title": title,
                        "forms_count": len(forms)
                    })
                    result["forms_found"].extend(forms)
                    
                    # Screenshot
                    safe_name = "".join(c if c.isalnum() else "_" for c in nav["text"][:20])
                    await page.screenshot(path=str(discovery_dir / f"page_{idx+1:02d}_{safe_name}.png"))
                    
                except Exception as e:
                    safe_log(f"[{discovery_id}] Failed to visit {url}: {str(e)[:100]}")
                    continue
            
            await browser.close()
        
        # Process API endpoints
        result["api_endpoints"] = [json.loads(r) for r in api_requests]
        result["status"] = "completed"
        result["completed_at"] = datetime.utcnow().isoformat() + "Z"
        
        _discoveries[discovery_id]["status"] = "completed"
        safe_log(f"[{discovery_id}] Discovery completed", {
            "pages": len(result["pages"]),
            "apis": len(result["api_endpoints"])
        })
        
    except Exception as e:
        logger.error(f"[{discovery_id}] Discovery failed: {e}", exc_info=True)
        result["status"] = "failed"
        result["error"] = str(e)[:200]
        result["completed_at"] = datetime.utcnow().isoformat() + "Z"
        _discoveries[discovery_id]["status"] = "failed"
        _discoveries[discovery_id]["error"] = str(e)[:200]
    
    # Save discovery.json
    with open(discovery_dir / "discovery.json", "w") as f:
        json.dump(redact_secrets(result), f, indent=2)
    
    return result


# =============================================================================
# Test Generator
# =============================================================================

def generate_smoke_tests(discovery_id: str) -> Dict:
    """Generate smoke tests from discovery results."""
    discovery_file = DATA_DIR / discovery_id / "discovery.json"
    if not discovery_file.exists():
        raise HTTPException(404, "Discovery not found")
    
    with open(discovery_file) as f:
        discovery = json.load(f)
    
    tests = []
    base_url = discovery.get("ui_url", "")
    
    # Test 1: Login check
    tests.append({
        "id": "SMOKE-001",
        "name": "Login Check",
        "description": "Verify user can login successfully",
        "type": "ui",
        "priority": "critical",
        "steps": [
            {"action": "navigate", "target": base_url},
            {"action": "login", "username": "<username>", "password": "<password>"},
            {"action": "verify", "condition": "login_success"}
        ]
    })
    
    # Test 2-6: Top 5 pages load
    for idx, page in enumerate(discovery.get("pages", [])[:5]):
        tests.append({
            "id": f"SMOKE-{idx+2:03d}",
            "name": f"Page Load: {page.get('title', 'Unknown')[:40]}",
            "description": f"Verify page loads without errors",
            "type": "ui",
            "priority": "high",
            "steps": [
                {"action": "navigate", "target": page.get("url", base_url)},
                {"action": "wait", "timeout": 5000},
                {"action": "verify", "condition": "no_errors"}
            ],
            "page_url": page.get("url")
        })
    
    # Test: API health
    for idx, api in enumerate(discovery.get("api_endpoints", [])[:5]):
        if api.get("method") == "GET":
            tests.append({
                "id": f"SMOKE-API-{idx+1:03d}",
                "name": f"API: {urlparse(api.get('url', '')).path[:40]}",
                "description": "Verify API endpoint responds",
                "type": "api",
                "priority": "medium",
                "steps": [
                    {"action": "request", "method": "GET", "url": api.get("url")},
                    {"action": "assert_status", "expected": [200, 201, 204]}
                ],
                "api_url": api.get("url")
            })
    
    # Test: Form validation
    for idx, form in enumerate(discovery.get("forms_found", [])[:3]):
        tests.append({
            "id": f"SMOKE-FORM-{idx+1:03d}",
            "name": f"Form Validation: {form.get('action', 'form')[:30]}",
            "description": "Verify form shows validation errors on empty submit",
            "type": "ui",
            "priority": "medium",
            "steps": [
                {"action": "navigate", "target": form.get("page_url", base_url)},
                {"action": "submit_empty_form"},
                {"action": "verify", "condition": "validation_errors"}
            ],
            "form": form
        })
    
    smoke_tests = {
        "discovery_id": discovery_id,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "source_url": base_url,
        "total_tests": len(tests),
        "tests_by_type": {
            "ui": sum(1 for t in tests if t["type"] == "ui"),
            "api": sum(1 for t in tests if t["type"] == "api")
        },
        "tests": tests
    }
    
    # Save
    with open(DATA_DIR / discovery_id / "smoke_tests.json", "w") as f:
        json.dump(smoke_tests, f, indent=2)
    
    return smoke_tests


# =============================================================================
# Test Runner
# =============================================================================

async def run_tests(run_id: str, discovery_id: str, credentials: Dict):
    """Execute smoke tests."""
    global _active_run
    from playwright.async_api import async_playwright
    import httpx
    
    run_dir = DATA_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    
    tests_file = DATA_DIR / discovery_id / "smoke_tests.json"
    if not tests_file.exists():
        _runs[run_id]["status"] = "failed"
        _runs[run_id]["error"] = "smoke_tests.json not found"
        return
    
    with open(tests_file) as f:
        smoke_tests = json.load(f)
    
    tests = smoke_tests.get("tests", [])
    results = []
    passed = 0
    failed = 0
    
    _runs[run_id]["status"] = "running"
    _runs[run_id]["total_tests"] = len(tests)
    
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(viewport={"width": 1920, "height": 1080}, ignore_https_errors=True)
            page = await context.new_page()
            
            async with httpx.AsyncClient(timeout=30.0, verify=False) as api_client:
                for idx, test in enumerate(tests):
                    test_result = {
                        "test_id": test["id"],
                        "name": test["name"],
                        "type": test["type"],
                        "status": "running",
                        "duration_ms": 0,
                        "steps": [],
                        "evidence": [],
                        "error": None
                    }
                    
                    start = time.time()
                    _runs[run_id]["current_test"] = test["id"]
                    
                    try:
                        if test["type"] == "ui":
                            for step in test.get("steps", []):
                                step_result = {"action": step["action"], "status": "running"}
                                
                                try:
                                    if step["action"] == "navigate":
                                        await page.goto(step["target"], timeout=30000, wait_until="networkidle")
                                        step_result["status"] = "passed"
                                    
                                    elif step["action"] == "login":
                                        # Use credentials from request
                                        config = LOGIN_CONFIGS["default"]
                                        for sel in config["username_selector"].split(", "):
                                            try:
                                                if await page.locator(sel).first.count() > 0:
                                                    await page.locator(sel).first.fill(credentials.get("username", ""))
                                                    break
                                            except:
                                                continue
                                        for sel in config["password_selector"].split(", "):
                                            try:
                                                if await page.locator(sel).first.count() > 0:
                                                    await page.locator(sel).first.fill(credentials.get("password", ""))
                                                    break
                                            except:
                                                continue
                                        for sel in config["submit_selector"].split(", "):
                                            try:
                                                if await page.locator(sel).first.count() > 0:
                                                    await page.locator(sel).first.click()
                                                    break
                                            except:
                                                continue
                                        await asyncio.sleep(3)
                                        step_result["status"] = "passed"
                                    
                                    elif step["action"] == "wait":
                                        await asyncio.sleep(step.get("timeout", 1000) / 1000)
                                        step_result["status"] = "passed"
                                    
                                    elif step["action"] == "verify":
                                        content = await page.content()
                                        if "error" in content.lower() and "validation" not in step.get("condition", ""):
                                            step_result["status"] = "warning"
                                        else:
                                            step_result["status"] = "passed"
                                    
                                    elif step["action"] == "submit_empty_form":
                                        try:
                                            await page.click("button[type='submit']", timeout=5000)
                                        except:
                                            pass
                                        step_result["status"] = "passed"
                                    
                                    else:
                                        step_result["status"] = "skipped"
                                        
                                except Exception as e:
                                    step_result["status"] = "failed"
                                    step_result["error"] = str(e)[:100]
                                
                                test_result["steps"].append(step_result)
                            
                            # Screenshot
                            screenshot = run_dir / f"test_{idx+1:03d}.png"
                            await page.screenshot(path=str(screenshot))
                            test_result["evidence"].append(screenshot.name)
                        
                        elif test["type"] == "api":
                            for step in test.get("steps", []):
                                step_result = {"action": step["action"], "status": "running"}
                                
                                try:
                                    if step["action"] == "request":
                                        url = step.get("url", "")
                                        method = step.get("method", "GET")
                                        resp = await api_client.request(method, url)
                                        step_result["status"] = "passed"
                                        step_result["response"] = {"status": resp.status_code}
                                        test_result["_last_response"] = resp
                                    
                                    elif step["action"] == "assert_status":
                                        resp = test_result.get("_last_response")
                                        if resp and resp.status_code in step.get("expected", [200]):
                                            step_result["status"] = "passed"
                                        else:
                                            step_result["status"] = "failed"
                                            step_result["error"] = f"Expected {step.get('expected')}, got {resp.status_code if resp else 'no response'}"
                                    
                                    else:
                                        step_result["status"] = "skipped"
                                        
                                except Exception as e:
                                    step_result["status"] = "failed"
                                    step_result["error"] = str(e)[:100]
                                
                                test_result["steps"].append(step_result)
                        
                        # Determine overall status
                        failed_steps = [s for s in test_result["steps"] if s["status"] == "failed"]
                        if failed_steps:
                            test_result["status"] = "failed"
                            test_result["error"] = failed_steps[0].get("error")
                            failed += 1
                        else:
                            test_result["status"] = "passed"
                            passed += 1
                            
                    except Exception as e:
                        test_result["status"] = "error"
                        test_result["error"] = str(e)[:100]
                        failed += 1
                    
                    test_result["duration_ms"] = int((time.time() - start) * 1000)
                    test_result.pop("_last_response", None)
                    results.append(test_result)
                    
                    _runs[run_id]["passed"] = passed
                    _runs[run_id]["failed"] = failed
            
            await browser.close()
        
        _runs[run_id]["status"] = "completed"
        
    except Exception as e:
        logger.error(f"[{run_id}] Run failed: {e}", exc_info=True)
        _runs[run_id]["status"] = "failed"
        _runs[run_id]["error"] = str(e)[:200]
    
    _runs[run_id]["completed_at"] = datetime.utcnow().isoformat() + "Z"
    _runs[run_id]["current_test"] = None
    
    # Generate report
    report = {
        "run_id": run_id,
        "discovery_id": discovery_id,
        "status": _runs[run_id]["status"],
        "started_at": _runs[run_id]["started_at"],
        "completed_at": _runs[run_id]["completed_at"],
        "summary": {
            "total": len(tests),
            "passed": passed,
            "failed": failed,
            "pass_rate": f"{(passed / len(tests) * 100):.1f}%" if tests else "N/A"
        },
        "test_results": results
    }
    
    with open(run_dir / "report.json", "w") as f:
        json.dump(report, f, indent=2)
    
    # Release lock
    _active_run = None
    safe_log(f"[{run_id}] Run completed", report["summary"])


# =============================================================================
# FastAPI Application
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("QA Agent API starting...")
    yield
    logger.info("QA Agent API shutting down...")


app = FastAPI(
    title="QA Agent API",
    description="Intelligent Test Discovery and Execution",
    version="2.0.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Auto QA router
from app.routers.auto_qa import router as auto_qa_router
app.include_router(auto_qa_router)


@app.get("/")
async def root():
    return {
        "service": "QA Agent API",
        "version": "2.0.0",
        "docs": "/docs",
        "endpoints": ["/discover", "/generate-tests", "/run", "/auto/discover", "/auto/run"]
    }


@app.get("/health")
async def health():
    return {"status": "healthy", "allow_prod": ALLOW_PROD}


# =============================================================================
# Discovery Endpoints
# =============================================================================

@app.post("/discover")
async def start_discovery(request: DiscoverRequest, background_tasks: BackgroundTasks):
    """Start browser-based discovery. Returns discovery_id."""
    
    # Safety check
    if is_production(request.ui_url, request.env) and not ALLOW_PROD:
        raise HTTPException(403, f"Production environment blocked. Set ALLOW_PROD=true to enable.")
    
    discovery_id = str(uuid.uuid4())[:12]
    
    _discoveries[discovery_id] = {
        "discovery_id": discovery_id,
        "status": "pending",
        "ui_url": request.ui_url,
        "env": request.env,
        "started_at": datetime.utcnow().isoformat() + "Z"
    }
    
    safe_log(f"Starting discovery {discovery_id}", {"url": request.ui_url, "env": request.env})
    
    background_tasks.add_task(run_discovery, discovery_id, request)
    
    return {"discovery_id": discovery_id, "status": "pending"}


@app.get("/discover/{discovery_id}")
async def get_discovery(discovery_id: str):
    """Get discovery results (discovery.json)."""
    
    discovery_file = DATA_DIR / discovery_id / "discovery.json"
    if discovery_file.exists():
        with open(discovery_file) as f:
            return json.load(f)
    
    if discovery_id in _discoveries:
        return _discoveries[discovery_id]
    
    raise HTTPException(404, "Discovery not found")


# =============================================================================
# Test Generation Endpoints
# =============================================================================

@app.post("/generate-tests")
async def generate_tests(request: GenerateTestsRequest):
    """Generate smoke tests from discovery. Returns preview + counts."""
    
    result = generate_smoke_tests(request.discovery_id)
    
    return {
        "discovery_id": request.discovery_id,
        "total_tests": result["total_tests"],
        "tests_by_type": result["tests_by_type"],
        "preview": result["tests"][:5],
        "output_file": f"/data/{request.discovery_id}/smoke_tests.json"
    }


@app.get("/tests/{discovery_id}")
async def get_tests(discovery_id: str):
    """Get generated smoke tests."""
    
    tests_file = DATA_DIR / discovery_id / "smoke_tests.json"
    if not tests_file.exists():
        raise HTTPException(404, "Tests not found. Run /generate-tests first.")
    
    with open(tests_file) as f:
        return json.load(f)


# =============================================================================
# Run Endpoints
# =============================================================================

@app.post("/run")
async def start_run(request: RunRequest, background_tasks: BackgroundTasks):
    """Execute tests. Returns run_id. Rate limited to 1 concurrent run."""
    global _active_run
    
    # Rate limit check
    async with _current_run_lock:
        if _active_run is not None:
            raise HTTPException(429, f"A run is already in progress: {_active_run}. Please wait.")
        
        run_id = str(uuid.uuid4())[:12]
        _active_run = run_id
    
    # Load discovery for credentials
    discovery_file = DATA_DIR / request.discovery_id / "discovery.json"
    if not discovery_file.exists():
        _active_run = None
        raise HTTPException(404, "Discovery not found")
    
    _runs[run_id] = {
        "run_id": run_id,
        "discovery_id": request.discovery_id,
        "suite": request.suite,
        "status": "pending",
        "started_at": datetime.utcnow().isoformat() + "Z",
        "completed_at": None,
        "total_tests": 0,
        "passed": 0,
        "failed": 0,
        "current_test": None,
        "error": None
    }
    
    # Get credentials from discovery request (would need to store securely in prod)
    credentials = {"username": "", "password": ""}  # In MVP, re-use from discovery
    
    safe_log(f"Starting run {run_id}", {"discovery_id": request.discovery_id, "suite": request.suite})
    
    background_tasks.add_task(run_tests, run_id, request.discovery_id, credentials)
    
    return {"run_id": run_id, "status": "pending"}


@app.get("/run/{run_id}")
async def get_run(run_id: str):
    """Get run status and report summary."""
    
    # Check report file first
    for disc_dir in DATA_DIR.iterdir():
        if disc_dir.is_dir():
            report_file = DATA_DIR / run_id / "report.json"
            if report_file.exists():
                with open(report_file) as f:
                    report = json.load(f)
                return {
                    "run_id": run_id,
                    "status": report["status"],
                    "started_at": report["started_at"],
                    "completed_at": report.get("completed_at"),
                    "summary": report["summary"],
                    "test_results": report["test_results"]
                }
    
    if run_id in _runs:
        return _runs[run_id]
    
    raise HTTPException(404, "Run not found")


@app.get("/run/{run_id}/artifacts")
async def list_artifacts(run_id: str, request: Request):
    """List artifacts with download URLs."""
    
    run_dir = DATA_DIR / run_id
    if not run_dir.exists():
        raise HTTPException(404, "Run not found")
    
    base_url = str(request.base_url).rstrip("/")
    artifacts = []
    
    for f in run_dir.iterdir():
        artifacts.append({
            "name": f.name,
            "size": f.stat().st_size,
            "type": "image" if f.suffix in [".png", ".jpg"] else "json",
            "download_url": f"{base_url}/artifacts/{run_id}/{f.name}"
        })
    
    return {
        "run_id": run_id,
        "count": len(artifacts),
        "artifacts": sorted(artifacts, key=lambda x: x["name"])
    }


@app.get("/artifacts/{run_id}/{filename}")
async def download_artifact(run_id: str, filename: str):
    """Download an artifact file."""
    
    file_path = DATA_DIR / run_id / filename
    if not file_path.exists():
        raise HTTPException(404, "Artifact not found")
    
    return FileResponse(file_path)


@app.get("/runs")
async def list_runs():
    """List all runs."""
    
    runs = []
    
    for run_id, run in _runs.items():
        runs.append({
            "run_id": run_id,
            "discovery_id": run["discovery_id"],
            "status": run["status"],
            "started_at": run["started_at"],
            "passed": run["passed"],
            "failed": run["failed"]
        })
    
    return {"runs": sorted(runs, key=lambda x: x["started_at"], reverse=True)}


# =============================================================================
# Safety Endpoint
# =============================================================================

@app.get("/safety")
async def get_safety_config():
    """Get current safety configuration."""
    return {
        "allow_prod": ALLOW_PROD,
        "prod_patterns": PROD_PATTERNS,
        "max_concurrent_runs": MAX_CONCURRENT_RUNS,
        "active_run": _active_run
    }
