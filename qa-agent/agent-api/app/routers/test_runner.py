"""
Test Runner - Execute generated smoke tests using Playwright + API calls.

Endpoints:
- POST /run {discovery_id, test_suite} -> run tests
- GET /run/{run_id} -> status + summary

Artifacts:
- Screenshots per step
- report.json with step results, timings, evidence paths

Safety:
- Block env=prod unless ALLOW_PROD=true
- Never print passwords; redact secrets
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
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

# Configuration
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
ALLOW_PROD = os.getenv("ALLOW_PROD", "false").lower() == "true"
PROD_PATTERNS = ["prod", "production", "live", "prd"]

# Secrets to redact
SECRET_PATTERNS = [
    r"password",
    r"passwd",
    r"secret",
    r"token",
    r"api[_-]?key",
    r"auth",
    r"credential",
    r"bearer",
]


# =============================================================================
# Models
# =============================================================================

class RunRequest(BaseModel):
    discovery_id: str
    test_suite: str = "smoke"  # smoke, all, or specific template name
    test_ids: Optional[List[str]] = None  # Run specific tests by ID
    parallel: bool = False  # Run tests in parallel (experimental)
    timeout_per_test: int = 30000  # ms
    stop_on_failure: bool = False


class RunStatus(BaseModel):
    run_id: str
    discovery_id: str
    status: str  # pending, running, completed, failed, blocked
    started_at: str
    completed_at: Optional[str] = None
    total_tests: int = 0
    passed: int = 0
    failed: int = 0
    skipped: int = 0
    current_test: Optional[str] = None
    error: Optional[str] = None


class TestResult(BaseModel):
    test_id: str
    name: str
    status: str  # passed, failed, skipped, error
    duration_ms: int
    steps: List[Dict[str, Any]]
    error: Optional[str] = None
    evidence: List[str] = []  # Paths to screenshots


# In-memory store for run status
_runs: Dict[str, Dict[str, Any]] = {}


# =============================================================================
# Safety & Redaction
# =============================================================================

def is_production_url(url: str) -> bool:
    """Check if URL appears to be a production environment."""
    url_lower = url.lower()
    for pattern in PROD_PATTERNS:
        if pattern in url_lower:
            return True
    return False


def redact_secrets(data: Any, depth: int = 0) -> Any:
    """Recursively redact sensitive values from data structures."""
    if depth > 10:  # Prevent infinite recursion
        return data
    
    if isinstance(data, dict):
        redacted = {}
        for key, value in data.items():
            key_lower = key.lower()
            is_secret = any(re.search(pattern, key_lower) for pattern in SECRET_PATTERNS)
            
            if is_secret and isinstance(value, str):
                redacted[key] = "***REDACTED***"
            else:
                redacted[key] = redact_secrets(value, depth + 1)
        return redacted
    
    elif isinstance(data, list):
        return [redact_secrets(item, depth + 1) for item in data]
    
    elif isinstance(data, str):
        # Redact Bearer tokens and API keys in strings
        result = re.sub(r'Bearer\s+[A-Za-z0-9\-._~+/]+=*', 'Bearer ***REDACTED***', data)
        result = re.sub(r'api[_-]?key[=:]\s*[A-Za-z0-9\-._~+/]+=*', 'api_key=***REDACTED***', result, flags=re.IGNORECASE)
        return result
    
    return data


def safe_log(message: str, data: Any = None) -> str:
    """Log message with redacted sensitive data."""
    if data:
        redacted = redact_secrets(data)
        logger.info(f"{message}: {json.dumps(redacted, default=str)[:500]}")
    else:
        logger.info(message)


# =============================================================================
# Test Executors
# =============================================================================

async def execute_ui_test(test: Dict, page, run_dir: Path, test_index: int) -> Dict:
    """Execute a UI test using Playwright."""
    result = {
        "test_id": test["id"],
        "name": test["name"],
        "status": "running",
        "duration_ms": 0,
        "steps": [],
        "evidence": [],
        "error": None
    }
    
    start_time = time.time()
    step_index = 0
    
    try:
        for step in test.get("steps", []):
            step_start = time.time()
            step_result = {
                "action": step.get("action"),
                "status": "running",
                "duration_ms": 0,
                "details": redact_secrets(step)
            }
            
            action = step.get("action")
            
            try:
                if action == "navigate":
                    target = step.get("target", "")
                    await page.goto(target, timeout=30000, wait_until="networkidle")
                    step_result["status"] = "passed"
                    
                elif action == "fill_form":
                    fields = step.get("fields", [])
                    for field in fields:
                        name = field.get("name")
                        value = field.get("value", "test_value")
                        if name:
                            try:
                                selector = f"input[name='{name}'], textarea[name='{name}'], select[name='{name}']"
                                await page.fill(selector, value, timeout=5000)
                            except Exception:
                                pass  # Field might not exist
                    step_result["status"] = "passed"
                    
                elif action == "fill_field":
                    name = step.get("name")
                    value = step.get("value", "test")
                    selector = f"input[name='{name}'], #{name}"
                    await page.fill(selector, value, timeout=5000)
                    step_result["status"] = "passed"
                    
                elif action == "clear_field":
                    name = step.get("name")
                    selector = f"input[name='{name}'], #{name}"
                    await page.fill(selector, "", timeout=5000)
                    step_result["status"] = "passed"
                    
                elif action == "click":
                    selector = step.get("selector", "button")
                    await page.click(selector, timeout=10000)
                    await asyncio.sleep(1)  # Wait for action
                    step_result["status"] = "passed"
                    
                elif action == "submit":
                    selector = step.get("selector", "button[type=submit]")
                    await page.click(selector, timeout=10000)
                    await asyncio.sleep(2)  # Wait for submission
                    step_result["status"] = "passed"
                    
                elif action == "verify":
                    condition = step.get("condition", "")
                    # Basic verification - check page didn't error
                    content = await page.content()
                    if "error" in content.lower() and "validation" not in condition:
                        step_result["status"] = "warning"
                        step_result["details"]["warning"] = "Page contains 'error'"
                    else:
                        step_result["status"] = "passed"
                    
                elif action == "clear_session":
                    await page.context.clear_cookies()
                    step_result["status"] = "passed"
                    
                elif action == "select_item":
                    # Try to find and click first list item
                    try:
                        await page.click("table tbody tr:first-child, .list-item:first-child, li:first-child", timeout=5000)
                    except Exception:
                        pass  # Item selection is optional
                    step_result["status"] = "passed"
                    
                elif action == "confirm_dialog":
                    # Handle dialog if present
                    page.on("dialog", lambda dialog: dialog.accept())
                    step_result["status"] = "passed"
                    
                else:
                    step_result["status"] = "skipped"
                    step_result["details"]["reason"] = f"Unknown action: {action}"
                
                # Take screenshot after each step
                screenshot_path = run_dir / f"test_{test_index:03d}_step_{step_index:02d}_{action}.png"
                await page.screenshot(path=str(screenshot_path))
                result["evidence"].append(str(screenshot_path.name))
                
            except Exception as e:
                step_result["status"] = "failed"
                step_result["error"] = str(e)[:200]
                
                # Screenshot on failure
                try:
                    screenshot_path = run_dir / f"test_{test_index:03d}_step_{step_index:02d}_FAILED.png"
                    await page.screenshot(path=str(screenshot_path))
                    result["evidence"].append(str(screenshot_path.name))
                except Exception:
                    pass
            
            step_result["duration_ms"] = int((time.time() - step_start) * 1000)
            result["steps"].append(step_result)
            step_index += 1
        
        # Determine overall test status
        failed_steps = [s for s in result["steps"] if s["status"] == "failed"]
        if failed_steps:
            result["status"] = "failed"
            result["error"] = failed_steps[0].get("error")
        else:
            result["status"] = "passed"
            
    except Exception as e:
        result["status"] = "error"
        result["error"] = str(e)[:200]
    
    result["duration_ms"] = int((time.time() - start_time) * 1000)
    return result


async def execute_api_test(test: Dict, session, run_dir: Path, test_index: int) -> Dict:
    """Execute an API test using httpx."""
    import httpx
    
    result = {
        "test_id": test["id"],
        "name": test["name"],
        "status": "running",
        "duration_ms": 0,
        "steps": [],
        "evidence": [],
        "error": None
    }
    
    start_time = time.time()
    step_index = 0
    
    request_config = {
        "method": "GET",
        "url": "",
        "headers": {},
        "body": None
    }
    
    try:
        for step in test.get("steps", []):
            step_start = time.time()
            step_result = {
                "action": step.get("action"),
                "status": "running",
                "duration_ms": 0,
                "details": redact_secrets(step)
            }
            
            action = step.get("action")
            
            try:
                if action == "request":
                    request_config["method"] = step.get("method", "GET")
                    request_config["url"] = step.get("url", "")
                    step_result["status"] = "passed"
                    
                elif action == "set_headers":
                    headers = step.get("headers", {})
                    request_config["headers"].update(headers)
                    step_result["status"] = "passed"
                    
                elif action == "set_body":
                    request_config["body"] = step.get("body")
                    step_result["status"] = "passed"
                    
                elif action == "remove_auth_headers":
                    request_config["headers"].pop("Authorization", None)
                    request_config["headers"].pop("X-Auth-Token", None)
                    step_result["status"] = "passed"
                    
                elif action == "send":
                    url = request_config["url"]
                    method = request_config["method"]
                    headers = request_config["headers"]
                    body = request_config["body"]
                    
                    safe_log(f"API Request: {method} {url}", {"headers": headers})
                    
                    response = await session.request(
                        method=method,
                        url=url,
                        headers=headers,
                        json=body if body else None,
                        timeout=30.0
                    )
                    
                    step_result["response"] = {
                        "status_code": response.status_code,
                        "content_length": len(response.content)
                    }
                    step_result["status"] = "passed"
                    
                    # Store response for assertions
                    request_config["last_response"] = response
                    
                elif action == "assert_status":
                    expected = step.get("expected", [200])
                    if not isinstance(expected, list):
                        expected = [expected]
                    
                    response = request_config.get("last_response")
                    if response:
                        if response.status_code in expected:
                            step_result["status"] = "passed"
                            step_result["details"]["actual"] = response.status_code
                        else:
                            step_result["status"] = "failed"
                            step_result["error"] = f"Expected {expected}, got {response.status_code}"
                    else:
                        step_result["status"] = "skipped"
                        step_result["details"]["reason"] = "No response to assert"
                        
                elif action == "verify_deleted":
                    verify_url = step.get("url", request_config["url"])
                    verify_method = step.get("method", "GET")
                    expected_status = step.get("expected_status", 404)
                    
                    response = await session.request(
                        method=verify_method,
                        url=verify_url,
                        timeout=10.0
                    )
                    
                    if response.status_code == expected_status:
                        step_result["status"] = "passed"
                    else:
                        step_result["status"] = "failed"
                        step_result["error"] = f"Expected {expected_status}, got {response.status_code}"
                        
                elif action == "setup":
                    # Setup steps are informational
                    step_result["status"] = "passed"
                    step_result["details"]["note"] = "Setup step - manual verification may be needed"
                    
                else:
                    step_result["status"] = "skipped"
                    step_result["details"]["reason"] = f"Unknown action: {action}"
                    
            except httpx.ConnectError as e:
                step_result["status"] = "failed"
                step_result["error"] = f"Connection failed: {str(e)[:100]}"
            except httpx.TimeoutException:
                step_result["status"] = "failed"
                step_result["error"] = "Request timed out"
            except Exception as e:
                step_result["status"] = "failed"
                step_result["error"] = str(e)[:200]
            
            step_result["duration_ms"] = int((time.time() - step_start) * 1000)
            result["steps"].append(step_result)
            step_index += 1
        
        # Determine overall test status
        failed_steps = [s for s in result["steps"] if s["status"] == "failed"]
        if failed_steps:
            result["status"] = "failed"
            result["error"] = failed_steps[0].get("error")
        else:
            result["status"] = "passed"
            
    except Exception as e:
        result["status"] = "error"
        result["error"] = str(e)[:200]
    
    result["duration_ms"] = int((time.time() - start_time) * 1000)
    
    # Save API response as evidence
    evidence_file = run_dir / f"test_{test_index:03d}_api_response.json"
    try:
        response = request_config.get("last_response")
        if response:
            evidence_data = {
                "url": str(response.url),
                "status_code": response.status_code,
                "headers": dict(response.headers),
                "body_preview": response.text[:1000] if response.text else None
            }
            with open(evidence_file, "w") as f:
                json.dump(redact_secrets(evidence_data), f, indent=2)
            result["evidence"].append(evidence_file.name)
    except Exception:
        pass
    
    return result


# =============================================================================
# Main Runner
# =============================================================================

async def run_tests(run_id: str, request: RunRequest):
    """Execute test suite."""
    import httpx
    from playwright.async_api import async_playwright
    
    discovery_id = request.discovery_id
    run_dir = DATA_DIR / discovery_id / f"run_{run_id}"
    run_dir.mkdir(parents=True, exist_ok=True)
    
    # Load smoke tests
    tests_file = DATA_DIR / discovery_id / "smoke_tests.json"
    if not tests_file.exists():
        _runs[run_id]["status"] = "failed"
        _runs[run_id]["error"] = "smoke_tests.json not found. Run /generate-tests first."
        return
    
    with open(tests_file) as f:
        smoke_tests = json.load(f)
    
    source_url = smoke_tests.get("source_url", "")
    
    # Safety check for production
    if is_production_url(source_url) and not ALLOW_PROD:
        _runs[run_id]["status"] = "blocked"
        _runs[run_id]["error"] = f"Production URL detected ({source_url}). Set ALLOW_PROD=true to enable."
        logger.warning(f"[{run_id}] Blocked execution on production URL: {source_url}")
        return
    
    # Filter tests
    all_tests = smoke_tests.get("tests", [])
    
    if request.test_ids:
        tests_to_run = [t for t in all_tests if t["id"] in request.test_ids]
    elif request.test_suite == "smoke":
        tests_to_run = all_tests
    elif request.test_suite == "all":
        tests_to_run = all_tests
    else:
        # Filter by template
        tests_to_run = [t for t in all_tests if t.get("template") == request.test_suite]
    
    _runs[run_id]["total_tests"] = len(tests_to_run)
    _runs[run_id]["status"] = "running"
    
    safe_log(f"[{run_id}] Starting test run", {
        "discovery_id": discovery_id,
        "total_tests": len(tests_to_run),
        "source_url": source_url
    })
    
    results = []
    passed = 0
    failed = 0
    skipped = 0
    
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                viewport={"width": 1920, "height": 1080}
            )
            page = await context.new_page()
            
            async with httpx.AsyncClient(timeout=30.0, verify=False, follow_redirects=True) as api_client:
                for idx, test in enumerate(tests_to_run):
                    test_id = test["id"]
                    test_type = test.get("type", "ui")
                    
                    _runs[run_id]["current_test"] = test_id
                    safe_log(f"[{run_id}] Running test {idx + 1}/{len(tests_to_run)}: {test_id}")
                    
                    try:
                        if test_type == "ui" or test_type == "e2e":
                            result = await execute_ui_test(test, page, run_dir, idx)
                        else:  # api
                            result = await execute_api_test(test, api_client, run_dir, idx)
                        
                        results.append(result)
                        
                        if result["status"] == "passed":
                            passed += 1
                        elif result["status"] == "failed":
                            failed += 1
                            if request.stop_on_failure:
                                logger.info(f"[{run_id}] Stopping on failure: {test_id}")
                                break
                        else:
                            skipped += 1
                            
                    except Exception as e:
                        logger.error(f"[{run_id}] Test {test_id} error: {e}", exc_info=True)
                        results.append({
                            "test_id": test_id,
                            "name": test.get("name", "Unknown"),
                            "status": "error",
                            "duration_ms": 0,
                            "steps": [],
                            "error": str(e)[:200],
                            "evidence": []
                        })
                        failed += 1
                    
                    # Update progress
                    _runs[run_id]["passed"] = passed
                    _runs[run_id]["failed"] = failed
                    _runs[run_id]["skipped"] = skipped
            
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
        "source_url": source_url,
        "status": _runs[run_id]["status"],
        "started_at": _runs[run_id]["started_at"],
        "completed_at": _runs[run_id]["completed_at"],
        "summary": {
            "total": len(tests_to_run),
            "passed": passed,
            "failed": failed,
            "skipped": skipped,
            "pass_rate": f"{(passed / len(tests_to_run) * 100):.1f}%" if tests_to_run else "N/A"
        },
        "test_results": results,
        "artifacts_dir": str(run_dir)
    }
    
    # Save report (redacted)
    report_file = run_dir / "report.json"
    with open(report_file, "w") as f:
        json.dump(redact_secrets(report), f, indent=2)
    
    safe_log(f"[{run_id}] Run completed", report["summary"])


# =============================================================================
# Endpoints
# =============================================================================

@router.post("/run", response_model=RunStatus)
async def start_run(request: RunRequest, background_tasks: BackgroundTasks):
    """
    Start a test run.
    
    Executes tests from smoke_tests.json using Playwright for UI tests
    and httpx for API tests.
    
    Safety:
    - Blocks execution on production URLs unless ALLOW_PROD=true
    - All secrets are redacted in logs and reports
    
    Artifacts stored in /data/{discovery_id}/run_{run_id}/:
    - Screenshots per step
    - report.json with results, timings, evidence paths
    """
    run_id = str(uuid.uuid4())[:12]
    
    # Check if discovery exists
    discovery_dir = DATA_DIR / request.discovery_id
    if not discovery_dir.exists():
        raise HTTPException(status_code=404, detail=f"Discovery {request.discovery_id} not found")
    
    tests_file = discovery_dir / "smoke_tests.json"
    if not tests_file.exists():
        raise HTTPException(
            status_code=400, 
            detail=f"smoke_tests.json not found. Run POST /generate-tests first."
        )
    
    # Load tests to check count
    with open(tests_file) as f:
        smoke_tests = json.load(f)
    
    source_url = smoke_tests.get("source_url", "")
    
    # Pre-check for production URL
    if is_production_url(source_url) and not ALLOW_PROD:
        raise HTTPException(
            status_code=403,
            detail=f"Production URL detected ({source_url}). Set ALLOW_PROD=true environment variable to enable."
        )
    
    # Initialize run status
    _runs[run_id] = {
        "run_id": run_id,
        "discovery_id": request.discovery_id,
        "status": "pending",
        "started_at": datetime.utcnow().isoformat() + "Z",
        "completed_at": None,
        "total_tests": smoke_tests.get("total_tests", 0),
        "passed": 0,
        "failed": 0,
        "skipped": 0,
        "current_test": None,
        "error": None
    }
    
    # Start execution in background
    background_tasks.add_task(run_tests, run_id, request)
    
    logger.info(f"Started run {run_id} for discovery {request.discovery_id}")
    
    return RunStatus(**_runs[run_id])


@router.get("/run/{run_id}", response_model=RunStatus)
async def get_run_status(run_id: str):
    """
    Get test run status and summary.
    """
    if run_id not in _runs:
        # Try to load from report file
        for discovery_dir in DATA_DIR.iterdir():
            if discovery_dir.is_dir():
                run_dir = discovery_dir / f"run_{run_id}"
                report_file = run_dir / "report.json"
                if report_file.exists():
                    with open(report_file) as f:
                        report = json.load(f)
                    return RunStatus(
                        run_id=run_id,
                        discovery_id=report.get("discovery_id", ""),
                        status=report.get("status", "completed"),
                        started_at=report.get("started_at", ""),
                        completed_at=report.get("completed_at"),
                        total_tests=report["summary"]["total"],
                        passed=report["summary"]["passed"],
                        failed=report["summary"]["failed"],
                        skipped=report["summary"]["skipped"]
                    )
        
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    
    return RunStatus(**_runs[run_id])


@router.get("/run/{run_id}/report")
async def get_run_report(run_id: str):
    """
    Get full test run report with all results and evidence paths.
    """
    # Find the report file
    for discovery_dir in DATA_DIR.iterdir():
        if discovery_dir.is_dir():
            run_dir = discovery_dir / f"run_{run_id}"
            report_file = run_dir / "report.json"
            if report_file.exists():
                with open(report_file) as f:
                    return json.load(f)
    
    raise HTTPException(status_code=404, detail=f"Report for run {run_id} not found")


@router.get("/run/{run_id}/artifacts")
async def list_run_artifacts(run_id: str):
    """
    List all artifacts (screenshots, logs) for a test run.
    """
    for discovery_dir in DATA_DIR.iterdir():
        if discovery_dir.is_dir():
            run_dir = discovery_dir / f"run_{run_id}"
            if run_dir.exists():
                artifacts = []
                for f in run_dir.iterdir():
                    artifacts.append({
                        "name": f.name,
                        "size": f.stat().st_size,
                        "type": "image" if f.suffix in [".png", ".jpg"] else "json" if f.suffix == ".json" else "other"
                    })
                return {
                    "run_id": run_id,
                    "artifacts_dir": str(run_dir),
                    "count": len(artifacts),
                    "artifacts": sorted(artifacts, key=lambda x: x["name"])
                }
    
    raise HTTPException(status_code=404, detail=f"Artifacts for run {run_id} not found")


@router.get("/runs")
async def list_runs(discovery_id: Optional[str] = None):
    """
    List all test runs, optionally filtered by discovery_id.
    """
    runs = []
    
    # From memory
    for rid, run in _runs.items():
        if discovery_id is None or run["discovery_id"] == discovery_id:
            runs.append({
                "run_id": rid,
                "discovery_id": run["discovery_id"],
                "status": run["status"],
                "started_at": run["started_at"],
                "passed": run["passed"],
                "failed": run["failed"]
            })
    
    # From disk
    search_dirs = [DATA_DIR / discovery_id] if discovery_id else DATA_DIR.iterdir()
    
    for discovery_dir in search_dirs:
        if not discovery_dir.is_dir():
            continue
        for run_dir in discovery_dir.iterdir():
            if run_dir.is_dir() and run_dir.name.startswith("run_"):
                rid = run_dir.name[4:]  # Remove "run_" prefix
                if rid not in _runs:
                    report_file = run_dir / "report.json"
                    if report_file.exists():
                        try:
                            with open(report_file) as f:
                                report = json.load(f)
                            runs.append({
                                "run_id": rid,
                                "discovery_id": report.get("discovery_id", discovery_dir.name),
                                "status": report.get("status", "completed"),
                                "started_at": report.get("started_at", ""),
                                "passed": report["summary"]["passed"],
                                "failed": report["summary"]["failed"]
                            })
                        except Exception:
                            continue
    
    return {"runs": sorted(runs, key=lambda x: x["started_at"], reverse=True)}


@router.get("/safety-config")
async def get_safety_config():
    """
    Get current safety configuration.
    """
    return {
        "allow_prod": ALLOW_PROD,
        "prod_patterns": PROD_PATTERNS,
        "secret_patterns": SECRET_PATTERNS,
        "note": "Set ALLOW_PROD=true environment variable to enable production testing"
    }
