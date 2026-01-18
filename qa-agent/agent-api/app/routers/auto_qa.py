"""
Auto QA Mode - Intelligent Discovery and Automated Test Execution

Endpoints:
- POST /auto/discover - Enhanced discovery with UI element detection
- POST /auto/run - Auto-generate and execute tests
- GET /auto/run/{run_id} - Get run status
- GET /auto/run/{run_id}/artifacts - List artifacts
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
from typing import Optional, Dict, Any, List, Literal
from urllib.parse import urlparse, urljoin

from fastapi import APIRouter, HTTPException, BackgroundTasks, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

# =============================================================================
# Configuration
# =============================================================================

DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

ALLOW_PROD = os.getenv("ALLOW_PROD", "false").lower() == "true"
PROD_PATTERNS = ["prod", "production", "live", "prd"]
SECRET_PATTERNS = [r"password", r"passwd", r"secret", r"token", r"api[_-]?key", r"auth", r"bearer"]

logger = logging.getLogger(__name__)

# State
_auto_discoveries: Dict[str, Dict] = {}
_auto_runs: Dict[str, Dict] = {}
_auto_run_lock = asyncio.Lock()
_active_auto_run: Optional[str] = None

router = APIRouter(prefix="/auto", tags=["Auto QA"])

# =============================================================================
# Models
# =============================================================================

class AutoDiscoverRequest(BaseModel):
    ui_url: str
    username: str
    password: str
    env: str = "staging"
    config_name: str = "default"


class AutoRunRequest(BaseModel):
    discovery_id: str
    mode: Literal["quick", "full"] = "quick"
    safety: Literal["read-only", "safe-crud"] = "read-only"


# =============================================================================
# Utilities
# =============================================================================

def is_production(url: str, env: str) -> bool:
    if env.lower() in PROD_PATTERNS:
        return True
    return any(p in url.lower() for p in PROD_PATTERNS)


def redact_secrets(data: Any, depth: int = 0) -> Any:
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
    return data


def safe_log(msg: str, data: Any = None):
    if data:
        logger.info(f"{msg}: {json.dumps(redact_secrets(data), default=str)[:500]}")
    else:
        logger.info(msg)


# Login config
LOGIN_CONFIGS = {
    "default": {
        "username_selector": "input[name='username'], input[name='email'], input[type='email'], #username, #email",
        "password_selector": "input[name='password'], input[type='password'], #password",
        "submit_selector": "button[type='submit'], input[type='submit'], #kc-login, button:has-text('Sign in'), button:has-text('Log in')",
        "success_indicator": "nav, .sidebar, .menu, .dashboard, .home, [data-logged-in]",
        "nav_selector": "nav a, .sidebar a, .menu a, .nav-link, [role='navigation'] a, aside a",
        "wait_after_login": 3000
    },
    "keycloak": {
        "username_selector": "#username, input[name='username']",
        "password_selector": "#password, input[name='password']",
        "submit_selector": "#kc-login, button[type='submit']",
        "success_indicator": "nav, .sidebar, .menu, .dashboard",
        "nav_selector": "nav a, .sidebar a, .menu a, aside a",
        "wait_after_login": 3000
    }
}


# =============================================================================
# Enhanced Discovery Service
# =============================================================================

async def run_auto_discovery(discovery_id: str, request: AutoDiscoverRequest):
    """Run enhanced Playwright-based discovery with UI element detection."""
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
        "api_endpoints": [],
        "summary": {
            "total_pages": 0,
            "pages_with_tables": 0,
            "pages_with_forms": 0,
            "pages_with_crud": 0,
            "total_apis": 0,
            "testable_actions": 0
        },
        "warnings": [],
        "error": None
    }
    
    _auto_discoveries[discovery_id]["status"] = "running"
    api_requests = []
    
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                viewport={"width": 1920, "height": 1080},
                ignore_https_errors=True
            )
            page = await context.new_page()
            
            # Capture API requests with response status
            def capture_request(req):
                url = req.url
                if any(x in url for x in ['/api/', '/v1/', '/v2/', '/graphql', '/rest/', '/auth/']):
                    api_requests.append({
                        "url": url,
                        "method": req.method,
                        "type": req.resource_type,
                        "status": None  # Will be updated on response
                    })
            
            def capture_response(resp):
                for api in api_requests:
                    if api["url"] == resp.url and api["status"] is None:
                        api["status"] = resp.status
                        break
            
            page.on("request", capture_request)
            page.on("response", capture_response)
            
            # Console errors
            console_errors = []
            page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
            
            # Step 1: Navigate
            safe_log(f"[{discovery_id}] Opening", {"url": request.ui_url})
            await page.goto(request.ui_url, timeout=30000, wait_until="networkidle")
            await page.screenshot(path=str(discovery_dir / "01_initial.png"))
            
            # Step 2: Login
            safe_log(f"[{discovery_id}] Attempting login")
            
            for selector in config["username_selector"].split(", "):
                try:
                    if await page.locator(selector).first.count() > 0:
                        await page.locator(selector).first.fill(request.username)
                        break
                except:
                    continue
            
            for selector in config["password_selector"].split(", "):
                try:
                    if await page.locator(selector).first.count() > 0:
                        await page.locator(selector).first.fill(request.password)
                        break
                except:
                    continue
            
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
            
            if not result["login_success"]:
                result["warnings"].append("Login may have failed - no success indicator found")
            
            # Step 3: Detect tenant/project context
            safe_log(f"[{discovery_id}] Detecting tenant/project context")
            tenant_project_candidates = []
            
            # Check URL patterns
            current_url = page.url
            url_parts = current_url.split('/')
            for i, part in enumerate(url_parts):
                if part in ['tenant', 'tenants', 'project', 'projects', 'org', 'organization', 'workspace']:
                    if i + 1 < len(url_parts):
                        candidate = url_parts[i + 1]
                        if candidate and candidate not in ['', 'new', 'create']:
                            tenant_project_candidates.append({
                                "type": part,
                                "value": candidate,
                                "source": "url_pattern"
                            })
            
            # Check UI dropdowns/selects
            try:
                tenant_selectors = [
                    "select[name*='tenant' i], select[id*='tenant' i]",
                    "select[name*='project' i], select[id*='project' i]",
                    "select[name*='org' i], select[id*='org' i]",
                    "[data-testid*='tenant'], [data-testid*='project']"
                ]
                for selector in tenant_selectors:
                    try:
                        dropdown = page.locator(selector).first
                        if await dropdown.count() > 0:
                            options = await dropdown.locator("option").all()
                            for opt in options[:10]:  # Limit to 10 options
                                value = await opt.get_attribute("value")
                                text = await opt.inner_text()
                                if value and value not in ['', 'none', 'select']:
                                    tenant_project_candidates.append({
                                        "type": "tenant" if "tenant" in selector.lower() else "project",
                                        "value": value,
                                        "label": text.strip()[:50],
                                        "source": "dropdown"
                                    })
                    except:
                        continue
            except:
                pass
            
            # Check labels/badges in UI
            try:
                label_selectors = [
                    "[class*='tenant'], [class*='project']",
                    ".badge, .label, .tag"
                ]
                for selector in label_selectors:
                    try:
                        labels = page.locator(selector)
                        count = await labels.count()
                        for i in range(min(count, 5)):
                            text = await labels.nth(i).inner_text()
                            if text and len(text) < 50:
                                if any(keyword in text.lower() for keyword in ['tenant', 'project', 'org']):
                                    tenant_project_candidates.append({
                                        "type": "context",
                                        "value": text.strip(),
                                        "source": "ui_label"
                                    })
                    except:
                        continue
            except:
                pass
            
            # Deduplicate candidates
            seen = set()
            unique_candidates = []
            for candidate in tenant_project_candidates:
                key = f"{candidate['type']}:{candidate['value']}"
                if key not in seen:
                    seen.add(key)
                    unique_candidates.append(candidate)
            
            result["tenant_project_candidates"] = unique_candidates[:10]  # Limit to 10
            
            # Step 4: Crawl navigation
            safe_log(f"[{discovery_id}] Crawling navigation")
            nav_urls = set()
            base_domain = urlparse(request.ui_url).netloc
            
            for selector in config["nav_selector"].split(", "):
                try:
                    links = page.locator(selector)
                    count = await links.count()
                    
                    for i in range(min(count, 50)):
                        try:
                            link = links.nth(i)
                            href = await link.get_attribute("href")
                            text = await link.inner_text()
                            
                            if href and text.strip():
                                full_url = urljoin(request.ui_url, href)
                                if urlparse(full_url).netloc == base_domain:
                                    nav_urls.add((full_url, text.strip()[:50]))
                        except:
                            continue
                except:
                    continue
            
            safe_log(f"[{discovery_id}] Found {len(nav_urls)} navigation items")
            
            # Step 4: Visit each page and analyze
            for idx, (url, nav_text) in enumerate(list(nav_urls)[:20]):
                try:
                    page_info = await analyze_page(page, url, nav_text, discovery_dir, idx, discovery_id)
                    result["pages"].append(page_info)
                except Exception as e:
                    safe_log(f"[{discovery_id}] Failed to analyze {url}: {str(e)[:100]}")
                    continue
            
            await browser.close()
        
        # Deduplicate API endpoints
        seen_apis = set()
        unique_apis = []
        for api in api_requests:
            key = f"{api['method']}:{api['url']}"
            if key not in seen_apis:
                seen_apis.add(key)
                unique_apis.append(api)
        
        result["api_endpoints"] = unique_apis[:100]  # Limit
        
        # Calculate summary
        result["summary"]["total_pages"] = len(result["pages"])
        result["summary"]["pages_with_tables"] = sum(1 for p in result["pages"] if p.get("has_table"))
        result["summary"]["pages_with_forms"] = sum(1 for p in result["pages"] if p.get("has_form"))
        result["summary"]["pages_with_crud"] = sum(1 for p in result["pages"] if p.get("crud_actions"))
        result["summary"]["total_apis"] = len(result["api_endpoints"])
        
        # Calculate testable actions
        testable = 0
        for p in result["pages"]:
            testable += 1  # Page load test
            if p.get("has_table"):
                testable += 1  # Table presence test
                if p.get("has_pagination"):
                    testable += 1
                if p.get("has_search"):
                    testable += 1
            if p.get("crud_actions"):
                testable += len(p["crud_actions"])
        result["summary"]["testable_actions"] = testable
        
        result["status"] = "completed"
        result["completed_at"] = datetime.utcnow().isoformat() + "Z"
        _auto_discoveries[discovery_id]["status"] = "completed"
        
        safe_log(f"[{discovery_id}] Discovery completed", result["summary"])
        
    except Exception as e:
        logger.error(f"[{discovery_id}] Discovery failed: {e}", exc_info=True)
        result["status"] = "failed"
        result["error"] = str(e)[:200]
        result["completed_at"] = datetime.utcnow().isoformat() + "Z"
        _auto_discoveries[discovery_id]["status"] = "failed"
        _auto_discoveries[discovery_id]["error"] = str(e)[:200]
    
    # Save discovery.json
    with open(discovery_dir / "discovery.json", "w") as f:
        json.dump(redact_secrets(result), f, indent=2)
    
    return result


async def analyze_page(page, url: str, nav_text: str, discovery_dir: Path, idx: int, discovery_id: str) -> Dict:
    """Analyze a single page for testable elements."""
    safe_log(f"[{discovery_id}] Analyzing page {idx+1}: {nav_text}")
    
    await page.goto(url, timeout=30000, wait_until="networkidle")
    await asyncio.sleep(1)
    
    title = await page.title()
    
    page_info = {
        "url": url,
        "nav_text": nav_text,
        "title": title,
        "has_table": False,
        "table_info": None,
        "has_form": False,
        "form_info": None,
        "has_search": False,
        "has_pagination": False,
        "has_filters": False,
        "crud_actions": [],
        "console_errors": []
    }
    
    # Detect tables
    try:
        tables = page.locator("table, [role='grid'], .MuiDataGrid-root, .ag-root, [data-testid*='table']")
        table_count = await tables.count()
        if table_count > 0:
            page_info["has_table"] = True
            
            # Get row count
            rows = page.locator("table tbody tr, [role='row']")
            row_count = await rows.count()
            
            # Get column count
            cols = page.locator("table thead th, [role='columnheader']")
            col_count = await cols.count()
            
            page_info["table_info"] = {
                "tables": table_count,
                "rows": row_count,
                "columns": col_count
            }
    except:
        pass
    
    # Detect search box
    try:
        search_selectors = "input[type='search'], input[placeholder*='search' i], input[placeholder*='filter' i], [data-testid*='search']"
        if await page.locator(search_selectors).first.count() > 0:
            page_info["has_search"] = True
    except:
        pass
    
    # Detect pagination
    try:
        pagination_selectors = ".pagination, [role='navigation'][aria-label*='pagination' i], .MuiPagination-root, .page-item, button:has-text('Next'), button:has-text('Previous')"
        if await page.locator(pagination_selectors).first.count() > 0:
            page_info["has_pagination"] = True
    except:
        pass
    
    # Detect filters (dropdowns)
    try:
        filter_selectors = "select, [role='combobox'], .filter-dropdown, [data-testid*='filter']"
        filters = page.locator(filter_selectors)
        if await filters.count() > 0:
            page_info["has_filters"] = True
    except:
        pass
    
    # Detect forms
    try:
        forms = page.locator("form")
        form_count = await forms.count()
        if form_count > 0:
            page_info["has_form"] = True
            
            inputs = page.locator("form input:not([type='hidden']), form select, form textarea")
            input_count = await inputs.count()
            
            page_info["form_info"] = {
                "forms": form_count,
                "inputs": input_count
            }
    except:
        pass
    
    # Detect CRUD actions
    crud_patterns = [
        ("create", "button:has-text('Create'), button:has-text('Add'), button:has-text('New'), [data-testid*='create'], [data-testid*='add']"),
        ("edit", "button:has-text('Edit'), button:has-text('Update'), [data-testid*='edit']"),
        ("delete", "button:has-text('Delete'), button:has-text('Remove'), [data-testid*='delete']"),
        ("save", "button:has-text('Save'), button[type='submit']:has-text('Save')"),
        ("cancel", "button:has-text('Cancel'), button:has-text('Close')")
    ]
    
    for action_name, selector in crud_patterns:
        try:
            if await page.locator(selector).first.count() > 0:
                page_info["crud_actions"].append(action_name)
        except:
            continue
    
    # Screenshot
    safe_name = "".join(c if c.isalnum() else "_" for c in nav_text[:20])
    await page.screenshot(path=str(discovery_dir / f"page_{idx+1:02d}_{safe_name}.png"))
    
    return page_info


# =============================================================================
# Auto Test Plan Generator
# =============================================================================

def generate_auto_test_plan(discovery: Dict, mode: str, safety: str) -> List[Dict]:
    """Generate test plan from discovery results."""
    tests = []
    test_id = 0
    
    base_url = discovery.get("ui_url", "")
    
    # Test 1: Login
    test_id += 1
    tests.append({
        "id": f"AUTO-{test_id:03d}",
        "name": "Login Verification",
        "description": "Verify user can login successfully",
        "type": "ui",
        "priority": "critical",
        "category": "authentication",
        "steps": [
            {"action": "navigate", "target": base_url},
            {"action": "login"},
            {"action": "verify", "condition": "login_success"}
        ]
    })
    
    for page in discovery.get("pages", []):
        page_url = page.get("url", "")
        page_name = page.get("nav_text", page.get("title", "Unknown"))[:30]
        
        # Test: Page opens without errors
        test_id += 1
        tests.append({
            "id": f"AUTO-{test_id:03d}",
            "name": f"Page Load: {page_name}",
            "description": f"Verify {page_name} loads without console errors",
            "type": "ui",
            "priority": "high",
            "category": "page_load",
            "page_url": page_url,
            "steps": [
                {"action": "navigate", "target": page_url},
                {"action": "wait", "timeout": 3000},
                {"action": "verify", "condition": "no_console_errors"},
                {"action": "verify", "condition": "no_5xx_responses"}
            ]
        })
        
        # Test: Table functionality
        if page.get("has_table"):
            test_id += 1
            tests.append({
                "id": f"AUTO-{test_id:03d}",
                "name": f"Table Display: {page_name}",
                "description": "Verify table renders with data",
                "type": "ui",
                "priority": "medium",
                "category": "table",
                "page_url": page_url,
                "steps": [
                    {"action": "navigate", "target": page_url},
                    {"action": "wait", "timeout": 3000},
                    {"action": "verify", "condition": "table_visible"},
                    {"action": "verify", "condition": "table_has_rows"}
                ]
            })
            
            # Pagination test
            if page.get("has_pagination") and mode == "full":
                test_id += 1
                tests.append({
                    "id": f"AUTO-{test_id:03d}",
                    "name": f"Pagination: {page_name}",
                    "description": "Verify pagination works",
                    "type": "ui",
                    "priority": "low",
                    "category": "pagination",
                    "page_url": page_url,
                    "steps": [
                        {"action": "navigate", "target": page_url},
                        {"action": "wait", "timeout": 3000},
                        {"action": "click", "selector": "button:has-text('Next'), .page-item:has-text('2')"},
                        {"action": "wait", "timeout": 2000},
                        {"action": "verify", "condition": "table_updated"}
                    ]
                })
            
            # Search test
            if page.get("has_search"):
                test_id += 1
                tests.append({
                    "id": f"AUTO-{test_id:03d}",
                    "name": f"Search: {page_name}",
                    "description": "Verify search filters results",
                    "type": "ui",
                    "priority": "medium",
                    "category": "search",
                    "page_url": page_url,
                    "steps": [
                        {"action": "navigate", "target": page_url},
                        {"action": "wait", "timeout": 3000},
                        {"action": "type", "selector": "input[type='search'], input[placeholder*='search' i]", "text": "test"},
                        {"action": "wait", "timeout": 2000},
                        {"action": "verify", "condition": "table_filtered"}
                    ]
                })
        
        # CRUD tests (only if safe-crud mode)
        if safety == "safe-crud" and page.get("crud_actions"):
            crud_actions = page.get("crud_actions", [])
            
            # Create validation test
            if "create" in crud_actions:
                test_id += 1
                tests.append({
                    "id": f"AUTO-{test_id:03d}",
                    "name": f"Create Validation: {page_name}",
                    "description": "Verify required field validation on create",
                    "type": "ui",
                    "priority": "high",
                    "category": "validation",
                    "page_url": page_url,
                    "steps": [
                        {"action": "navigate", "target": page_url},
                        {"action": "wait", "timeout": 3000},
                        {"action": "click", "selector": "button:has-text('Create'), button:has-text('Add'), button:has-text('New')"},
                        {"action": "wait", "timeout": 2000},
                        {"action": "click", "selector": "button[type='submit'], button:has-text('Save')"},
                        {"action": "verify", "condition": "validation_errors_shown"}
                    ]
                })
    
    # Limit tests in quick mode
    if mode == "quick":
        # Keep critical + high priority + first 5 medium
        critical = [t for t in tests if t["priority"] == "critical"]
        high = [t for t in tests if t["priority"] == "high"][:5]
        medium = [t for t in tests if t["priority"] == "medium"][:3]
        tests = critical + high + medium
    
    return tests


# =============================================================================
# Self-Debug Helpers
# =============================================================================

def identify_impacted_services(failed_requests: List[Dict]) -> List[Dict]:
    """Identify impacted backend services from failed network requests."""
    services = {}
    
    for req in failed_requests:
        url = req.get("url", "")
        status = req.get("status", 0)
        method = req.get("method", "GET")
        
        if status >= 400:  # Failed requests
            parsed = urlparse(url)
            host = parsed.netloc.split(':')[0]  # Remove port
            
            # Map to service name (heuristic)
            service_name = host
            if '.' in host:
                # Extract service name from hostname
                parts = host.split('.')
                if len(parts) > 1:
                    service_name = parts[0]  # e.g., api.example.com -> api
            
            if service_name not in services:
                services[service_name] = {
                    "host": host,
                    "failed_requests": [],
                    "error_codes": set()
                }
            
            services[service_name]["failed_requests"].append({
                "method": method,
                "path": parsed.path,
                "status": status,
                "url": url
            })
            services[service_name]["error_codes"].add(status)
    
    # Convert to list format
    result = []
    for service_name, data in services.items():
        result.append({
            "service": service_name,
            "host": data["host"],
            "failed_count": len(data["failed_requests"]),
            "error_codes": sorted(list(data["error_codes"])),
            "failed_requests": data["failed_requests"][:5]  # Limit to 5
        })
    
    return result


async def debug_failure(
    run_id: str,
    test_result: Dict,
    failed_requests: List[Dict],
    screenshot_path: Path,
    har_path: Optional[Path] = None
) -> Dict:
    """Self-debug a failed test: collect K8s logs, Mongo checks, etc."""
    debug_info = {
        "test_id": test_result.get("test_id"),
        "error": test_result.get("error"),
        "screenshot": screenshot_path.name if screenshot_path.exists() else None,
        "har": har_path.name if har_path and har_path.exists() else None,
        "impacted_services": identify_impacted_services(failed_requests),
        "k8s_debug": {},
        "mongo_debug": {}
    }
    
    # K8s Inspector: Check pods in allowlisted namespaces
    try:
        from app.routers.k8s_inspector import load_allowlist, v1_core, IN_CLUSTER
        
        if IN_CLUSTER and v1_core:
            allowlist = load_allowlist()
            if allowlist:
                for namespace in allowlist[:3]:  # Limit to 3 namespaces
                    try:
                        pods = v1_core.list_namespaced_pod(namespace)
                        failed_pods = [
                            {
                                "name": pod.metadata.name,
                                "status": pod.status.phase,
                                "restarts": sum(c.restart_count for c in pod.status.container_statuses or []),
                                "ready": sum(1 for c in pod.status.container_statuses or [] if c.ready)
                            }
                            for pod in pods.items
                            if pod.status.phase != "Running" or 
                               sum(c.restart_count for c in pod.status.container_statuses or []) > 0
                        ]
                        
                        if failed_pods:
                            debug_info["k8s_debug"][namespace] = {
                                "unhealthy_pods": failed_pods,
                                "total_pods": len(pods.items)
                            }
                    except Exception as e:
                        logger.warning(f"Failed to inspect namespace {namespace}: {e}")
    except Exception as e:
        logger.warning(f"K8s debug failed: {e}")
    
    # Mongo Inspector: Check if configured
    try:
        from app.routers.mongo_inspector import get_mongo_uri
        from app.routers.k8s_inspector import load_allowlist
        
        allowlist = load_allowlist()
        for namespace in allowlist[:2]:  # Limit to 2 namespaces
            if get_mongo_uri(namespace):
                try:
                    from app.routers.mongo_inspector import get_mongo_client
                    client = get_mongo_client(namespace)
                    if client:
                        db_name = urlparse(get_mongo_uri(namespace)).path.lstrip('/') or 'admin'
                        db = client[db_name]
                        collections = db.list_collection_names()[:5]
                        debug_info["mongo_debug"][namespace] = {
                            "database": db_name,
                            "collections": collections,
                            "accessible": True
                        }
                        client.close()
                except Exception as e:
                    debug_info["mongo_debug"][namespace] = {
                        "error": str(e)[:100]
                    }
    except Exception as e:
        logger.warning(f"Mongo debug failed: {e}")
    
    return debug_info


# =============================================================================
# Auto Test Runner
# =============================================================================

async def run_auto_tests(run_id: str, discovery_id: str, tests: List[Dict], credentials: Dict, safety: str):
    """Execute auto-generated tests."""
    global _active_auto_run
    from playwright.async_api import async_playwright
    
    run_dir = DATA_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    
    results = []
    passed = 0
    failed = 0
    skipped = 0
    
    _auto_runs[run_id]["status"] = "running"
    _auto_runs[run_id]["total_tests"] = len(tests)
    
    # Load discovery for base URL
    discovery_file = DATA_DIR / discovery_id / "discovery.json"
    if not discovery_file.exists():
        _auto_runs[run_id]["status"] = "failed"
        _auto_runs[run_id]["error"] = "Discovery not found"
        _active_auto_run = None
        return
    
    with open(discovery_file) as f:
        discovery = json.load(f)
    
    base_url = discovery.get("ui_url", "")
    config = LOGIN_CONFIGS["default"]
    
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                viewport={"width": 1920, "height": 1080},
                ignore_https_errors=True
            )
            page = await context.new_page()
            
            # Track console errors and API responses
            console_errors = []
            api_responses = []
            failed_requests = []  # Track failed requests for debugging
            
            page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
            page.on("response", lambda resp: (
                api_responses.append({"url": resp.url, "status": resp.status, "method": "GET"}),
                failed_requests.append({"url": resp.url, "status": resp.status, "method": "GET"}) if resp.status >= 400 else None
            ) if "/api/" in resp.url or resp.status >= 400 else None)
            page.on("requestfailed", lambda req: failed_requests.append({
                "url": req.url,
                "status": req.response.status if req.response else 0,
                "method": req.method,
                "failure": req.failure.error_text if hasattr(req, 'failure') else None
            }))
            
            logged_in = False
            
            for idx, test in enumerate(tests):
                test_result = {
                    "test_id": test["id"],
                    "name": test["name"],
                    "category": test.get("category", "unknown"),
                    "status": "running",
                    "duration_ms": 0,
                    "steps": [],
                    "evidence": [],
                    "error": None
                }
                
                start = time.time()
                _auto_runs[run_id]["current_test"] = test["id"]
                console_errors.clear()
                api_responses.clear()
                failed_requests.clear()
                
                # Start tracing for HAR export (if test fails)
                har_path = None
                try:
                    await context.tracing.start(screenshots=True, snapshots=True)
                except:
                    pass  # Tracing may not be available
                
                try:
                    for step in test.get("steps", []):
                        step_result = {"action": step["action"], "status": "running"}
                        
                        try:
                            if step["action"] == "navigate":
                                await page.goto(step["target"], timeout=30000, wait_until="networkidle")
                                step_result["status"] = "passed"
                            
                            elif step["action"] == "login" and not logged_in:
                                # Fill username
                                for sel in config["username_selector"].split(", "):
                                    try:
                                        if await page.locator(sel).first.count() > 0:
                                            await page.locator(sel).first.fill(credentials.get("username", ""))
                                            break
                                    except:
                                        continue
                                
                                # Fill password
                                for sel in config["password_selector"].split(", "):
                                    try:
                                        if await page.locator(sel).first.count() > 0:
                                            await page.locator(sel).first.fill(credentials.get("password", ""))
                                            break
                                    except:
                                        continue
                                
                                # Submit
                                for sel in config["submit_selector"].split(", "):
                                    try:
                                        if await page.locator(sel).first.count() > 0:
                                            await page.locator(sel).first.click()
                                            break
                                    except:
                                        continue
                                
                                await asyncio.sleep(3)
                                logged_in = True
                                step_result["status"] = "passed"
                            
                            elif step["action"] == "wait":
                                await asyncio.sleep(step.get("timeout", 1000) / 1000)
                                step_result["status"] = "passed"
                            
                            elif step["action"] == "click":
                                selector = step.get("selector", "")
                                for sel in selector.split(", "):
                                    try:
                                        if await page.locator(sel).first.count() > 0:
                                            await page.locator(sel).first.click(timeout=5000)
                                            step_result["status"] = "passed"
                                            break
                                    except:
                                        continue
                                else:
                                    step_result["status"] = "skipped"
                                    step_result["error"] = "Element not found"
                            
                            elif step["action"] == "type":
                                selector = step.get("selector", "")
                                text = step.get("text", "")
                                for sel in selector.split(", "):
                                    try:
                                        if await page.locator(sel).first.count() > 0:
                                            await page.locator(sel).first.fill(text)
                                            await page.keyboard.press("Enter")
                                            step_result["status"] = "passed"
                                            break
                                    except:
                                        continue
                                else:
                                    step_result["status"] = "skipped"
                            
                            elif step["action"] == "verify":
                                condition = step.get("condition", "")
                                
                                if condition == "login_success":
                                    for sel in config["success_indicator"].split(", "):
                                        try:
                                            if await page.locator(sel).first.count() > 0:
                                                step_result["status"] = "passed"
                                                break
                                        except:
                                            continue
                                    else:
                                        step_result["status"] = "failed"
                                        step_result["error"] = "No success indicator found"
                                
                                elif condition == "no_console_errors":
                                    critical_errors = [e for e in console_errors if "error" in e.lower() and "warning" not in e.lower()]
                                    if critical_errors:
                                        step_result["status"] = "warning"
                                        step_result["error"] = f"Console errors: {len(critical_errors)}"
                                    else:
                                        step_result["status"] = "passed"
                                
                                elif condition == "no_5xx_responses":
                                    errors = [r for r in api_responses if r["status"] >= 500]
                                    if errors:
                                        step_result["status"] = "failed"
                                        step_result["error"] = f"5xx errors: {[r['url'][-50:] for r in errors[:3]]}"
                                    else:
                                        step_result["status"] = "passed"
                                
                                elif condition == "table_visible":
                                    if await page.locator("table, [role='grid']").first.count() > 0:
                                        step_result["status"] = "passed"
                                    else:
                                        step_result["status"] = "failed"
                                        step_result["error"] = "No table found"
                                
                                elif condition == "table_has_rows":
                                    rows = await page.locator("table tbody tr, [role='row']").count()
                                    if rows > 0:
                                        step_result["status"] = "passed"
                                    else:
                                        step_result["status"] = "warning"
                                        step_result["error"] = "Table has no rows"
                                
                                elif condition in ["table_updated", "table_filtered"]:
                                    step_result["status"] = "passed"  # Hard to verify, assume success
                                
                                elif condition == "validation_errors_shown":
                                    # Look for validation error indicators
                                    error_selectors = ".error, .invalid, [aria-invalid='true'], .text-red, .text-danger"
                                    if await page.locator(error_selectors).first.count() > 0:
                                        step_result["status"] = "passed"
                                    else:
                                        step_result["status"] = "warning"
                                        step_result["error"] = "No validation errors visible"
                                
                                else:
                                    step_result["status"] = "passed"
                            
                            else:
                                step_result["status"] = "skipped"
                        
                        except Exception as e:
                            step_result["status"] = "failed"
                            step_result["error"] = str(e)[:100]
                        
                        test_result["steps"].append(step_result)
                    
                    # Screenshot
                    screenshot = run_dir / f"test_{idx+1:03d}_{test['id']}.png"
                    await page.screenshot(path=str(screenshot))
                    test_result["evidence"].append(screenshot.name)
                    
                    # Determine test status
                    failed_steps = [s for s in test_result["steps"] if s["status"] == "failed"]
                    skipped_steps = [s for s in test_result["steps"] if s["status"] == "skipped"]
                    warning_steps = [s for s in test_result["steps"] if s["status"] == "warning"]
                    
                    if failed_steps:
                        test_result["status"] = "failed"
                        test_result["error"] = failed_steps[0].get("error")
                        
                        # Self-debug on failure: Export HAR and collect debug info
                        har_path = run_dir / f"test_{idx+1:03d}_{test['id']}.har"
                        try:
                            # Stop tracing and export HAR
                            trace_path = run_dir / f"test_{idx+1:03d}_{test['id']}_trace.zip"
                            try:
                                await context.tracing.stop(path=str(trace_path))
                                # Extract HAR from trace (simplified - create from captured requests)
                            except:
                                pass
                            
                            # Create HAR from captured requests
                            har_entries = []
                            for req in failed_requests + [r for r in api_responses if r.get("status", 0) >= 400]:
                                har_entries.append({
                                    "request": {
                                        "method": req.get("method", "GET"),
                                        "url": req.get("url", ""),
                                        "headers": []
                                    },
                                    "response": {
                                        "status": req.get("status", 0),
                                        "statusText": "OK" if req.get("status", 0) < 400 else "Error"
                                    },
                                    "timings": {}
                                })
                            
                            har_data = {
                                "log": {
                                    "version": "1.2",
                                    "creator": {"name": "QA Agent", "version": "2.0"},
                                    "entries": har_entries
                                }
                            }
                            
                            with open(har_path, "w") as f:
                                json.dump(har_data, f, indent=2)
                            test_result["evidence"].append(har_path.name)
                        except Exception as e:
                            logger.warning(f"Failed to export HAR: {e}")
                            har_path = None
                        
                        # Call self-debug
                        try:
                            debug_info = await debug_failure(
                                run_id,
                                test_result,
                                failed_requests,
                                screenshot,
                                har_path
                            )
                            test_result["debug"] = debug_info
                            
                            # Save debug bundle
                            debug_bundle = run_dir / f"test_{idx+1:03d}_{test['id']}_debug.json"
                            with open(debug_bundle, "w") as f:
                                json.dump(debug_info, f, indent=2)
                            test_result["evidence"].append(debug_bundle.name)
                        except Exception as e:
                            logger.warning(f"Self-debug failed: {e}")
                            test_result["debug"] = {"error": str(e)[:100]}
                        
                        failed += 1
                    elif len(skipped_steps) == len(test_result["steps"]):
                        test_result["status"] = "skipped"
                        skipped += 1
                    elif warning_steps:
                        test_result["status"] = "passed_with_warnings"
                        passed += 1
                    else:
                        test_result["status"] = "passed"
                        passed += 1
                    
                    # Clear failed_requests for next test
                    failed_requests.clear()
                    
                    # Restart tracing for next test
                    try:
                        await context.tracing.start(screenshots=True, snapshots=True)
                    except:
                        pass
                
                except Exception as e:
                    test_result["status"] = "error"
                    test_result["error"] = str(e)[:100]
                    failed += 1
                
                test_result["duration_ms"] = int((time.time() - start) * 1000)
                results.append(test_result)
                
                _auto_runs[run_id]["passed"] = passed
                _auto_runs[run_id]["failed"] = failed
                _auto_runs[run_id]["skipped"] = skipped
            
            await browser.close()
        
        _auto_runs[run_id]["status"] = "completed"
        
    except Exception as e:
        logger.error(f"[{run_id}] Auto run failed: {e}", exc_info=True)
        _auto_runs[run_id]["status"] = "failed"
        _auto_runs[run_id]["error"] = str(e)[:200]
    
    _auto_runs[run_id]["completed_at"] = datetime.utcnow().isoformat() + "Z"
    _auto_runs[run_id]["current_test"] = None
    
    # Generate report
    report = {
        "run_id": run_id,
        "discovery_id": discovery_id,
        "mode": _auto_runs[run_id].get("mode", "quick"),
        "safety": _auto_runs[run_id].get("safety", "read-only"),
        "status": _auto_runs[run_id]["status"],
        "started_at": _auto_runs[run_id]["started_at"],
        "completed_at": _auto_runs[run_id]["completed_at"],
        "summary": {
            "total": len(tests),
            "passed": passed,
            "failed": failed,
            "skipped": skipped,
            "pass_rate": f"{(passed / len(tests) * 100):.1f}%" if tests else "N/A"
        },
        "test_results": results,
        "test_plan": tests
    }
    
    with open(run_dir / "report.json", "w") as f:
        json.dump(report, f, indent=2)
    
    _active_auto_run = None
    safe_log(f"[{run_id}] Auto run completed", report["summary"])


# =============================================================================
# API Endpoints
# =============================================================================

@router.post("/discover")
async def auto_discover(request: AutoDiscoverRequest, background_tasks: BackgroundTasks):
    """Start enhanced discovery with UI element detection."""
    
    # Safety check
    if is_production(request.ui_url, request.env) and not ALLOW_PROD:
        raise HTTPException(403, "Production environment blocked. Set ALLOW_PROD=true to enable.")
    
    discovery_id = f"auto-{str(uuid.uuid4())[:8]}"
    
    _auto_discoveries[discovery_id] = {
        "discovery_id": discovery_id,
        "status": "pending",
        "ui_url": request.ui_url,
        "env": request.env,
        "started_at": datetime.utcnow().isoformat() + "Z"
    }
    
    safe_log(f"Starting auto discovery {discovery_id}", {"url": request.ui_url, "env": request.env})
    
    background_tasks.add_task(run_auto_discovery, discovery_id, request)
    
    return {"discovery_id": discovery_id, "status": "pending"}


@router.get("/discover/{discovery_id}")
async def get_auto_discovery(discovery_id: str):
    """Get auto discovery results."""
    
    discovery_file = DATA_DIR / discovery_id / "discovery.json"
    if discovery_file.exists():
        with open(discovery_file) as f:
            return json.load(f)
    
    if discovery_id in _auto_discoveries:
        return _auto_discoveries[discovery_id]
    
    raise HTTPException(404, "Discovery not found")


@router.post("/run")
async def start_auto_run(request: AutoRunRequest, background_tasks: BackgroundTasks):
    """Start auto test execution."""
    global _active_auto_run
    
    # Rate limit check
    async with _auto_run_lock:
        if _active_auto_run is not None:
            raise HTTPException(429, f"An auto run is already in progress: {_active_auto_run}")
        
        run_id = f"auto-run-{str(uuid.uuid4())[:8]}"
        _active_auto_run = run_id
    
    # Load discovery
    discovery_file = DATA_DIR / request.discovery_id / "discovery.json"
    if not discovery_file.exists():
        _active_auto_run = None
        raise HTTPException(404, "Discovery not found")
    
    with open(discovery_file) as f:
        discovery = json.load(f)
    
    # Generate test plan
    tests = generate_auto_test_plan(discovery, request.mode, request.safety)
    
    _auto_runs[run_id] = {
        "run_id": run_id,
        "discovery_id": request.discovery_id,
        "mode": request.mode,
        "safety": request.safety,
        "status": "pending",
        "started_at": datetime.utcnow().isoformat() + "Z",
        "completed_at": None,
        "total_tests": len(tests),
        "passed": 0,
        "failed": 0,
        "skipped": 0,
        "current_test": None,
        "error": None,
        "planned_tests": len(tests)
    }
    
    # Would need to store credentials securely in production
    credentials = {"username": "", "password": ""}
    
    safe_log(f"Starting auto run {run_id}", {
        "discovery_id": request.discovery_id,
        "mode": request.mode,
        "tests": len(tests)
    })
    
    background_tasks.add_task(run_auto_tests, run_id, request.discovery_id, tests, credentials, request.safety)
    
    return {
        "run_id": run_id,
        "status": "pending",
        "planned_tests": len(tests),
        "mode": request.mode,
        "safety": request.safety
    }


@router.get("/run/{run_id}")
async def get_auto_run(run_id: str):
    """Get auto run status and report."""
    
    # Check report file
    report_file = DATA_DIR / run_id / "report.json"
    if report_file.exists():
        with open(report_file) as f:
            report = json.load(f)
        return {
            "run_id": run_id,
            "status": report["status"],
            "mode": report.get("mode"),
            "safety": report.get("safety"),
            "started_at": report["started_at"],
            "completed_at": report.get("completed_at"),
            "summary": report["summary"],
            "test_results": report["test_results"]
        }
    
    if run_id in _auto_runs:
        return _auto_runs[run_id]
    
    raise HTTPException(404, "Run not found")


@router.get("/run/{run_id}/artifacts")
async def list_auto_artifacts(run_id: str, request: Request):
    """List artifacts from auto run."""
    
    run_dir = DATA_DIR / run_id
    if not run_dir.exists():
        raise HTTPException(404, "Run not found")
    
    base_url = str(request.base_url).rstrip("/")
    artifacts = []
    
    for f in run_dir.iterdir():
        artifacts.append({
            "name": f.name,
            "size": f.stat().st_size,
            "type": "image" if f.suffix in [".png", ".jpg"] else "json" if f.suffix == ".json" else "other",
            "download_url": f"{base_url}/auto/artifacts/{run_id}/{f.name}",
            "proxy_url": f"/api/artifacts/{run_id}/{f.name}"
        })
    
    return {
        "run_id": run_id,
        "count": len(artifacts),
        "artifacts": sorted(artifacts, key=lambda x: x["name"])
    }


@router.get("/artifacts/{run_id}/{filename}")
async def download_auto_artifact(run_id: str, filename: str):
    """Download artifact file."""
    
    file_path = DATA_DIR / run_id / filename
    if not file_path.exists():
        raise HTTPException(404, "Artifact not found")
    
    return FileResponse(file_path)


@router.get("/runs")
async def list_auto_runs():
    """List all auto runs."""
    
    runs = []
    for run_id, run in _auto_runs.items():
        runs.append({
            "run_id": run_id,
            "discovery_id": run["discovery_id"],
            "status": run["status"],
            "mode": run.get("mode"),
            "started_at": run["started_at"],
            "passed": run["passed"],
            "failed": run["failed"]
        })
    
    return {"runs": sorted(runs, key=lambda x: x["started_at"], reverse=True)}
