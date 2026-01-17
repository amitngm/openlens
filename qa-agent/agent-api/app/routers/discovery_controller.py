"""
QA Agent Discovery Controller - Real browser-based discovery using Playwright.

Endpoints:
- POST /discover - Start a discovery session
- GET /discover/{id} - Get discovery results
"""

import os
import json
import uuid
import asyncio
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List, Set
from urllib.parse import urlparse, urljoin

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()

# Data directory for storing discovery results
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Config directory for login selectors
CONFIG_DIR = Path(os.getenv("CONFIG_DIR", "/app/config"))


class DiscoveryRequest(BaseModel):
    ui_url: str
    username: str
    password: str
    config_name: Optional[str] = "default"  # Name of login config to use
    max_pages: Optional[int] = 20  # Max pages to crawl
    timeout: Optional[int] = 30000  # Page timeout in ms


class DiscoveryStatus(BaseModel):
    discovery_id: str
    status: str  # pending, running, completed, failed
    ui_url: str
    started_at: str
    completed_at: Optional[str] = None
    error: Optional[str] = None
    pages_discovered: int = 0
    api_endpoints_found: int = 0


class DiscoveryResult(BaseModel):
    discovery_id: str
    status: str
    ui_url: str
    started_at: str
    completed_at: Optional[str] = None
    login_success: bool = False
    pages: List[Dict[str, Any]] = []
    navigation_items: List[Dict[str, Any]] = []
    api_endpoints: List[Dict[str, Any]] = []
    forms_found: List[Dict[str, Any]] = []
    error: Optional[str] = None


# In-memory store for discovery status (in production, use Redis/DB)
_discoveries: Dict[str, Dict[str, Any]] = {}


def get_login_config(config_name: str) -> Dict[str, Any]:
    """
    Load login selector configuration.
    
    Config format:
    {
        "username_selector": "#username",
        "password_selector": "#password",
        "submit_selector": "button[type=submit]",
        "success_indicator": ".dashboard, .home, [data-logged-in]",
        "nav_selector": "nav a, .sidebar a, .menu a"
    }
    """
    # Default selectors that work for many apps
    default_config = {
        "username_selector": "input[type='email'], input[type='text'][name*='user'], input[name='username'], input[name='email'], #username, #email",
        "password_selector": "input[type='password'], input[name='password'], #password",
        "submit_selector": "button[type='submit'], input[type='submit'], button:has-text('Login'), button:has-text('Sign in'), button:has-text('Log in')",
        "success_indicator": ".dashboard, .home, nav, .sidebar, .menu, [data-logged-in], .user-menu, .profile",
        "nav_selector": "nav a, .sidebar a, .menu a, .nav-link, [role='navigation'] a",
        "wait_after_login": 3000
    }
    
    # Try to load custom config
    config_file = CONFIG_DIR / f"{config_name}.json"
    if config_file.exists():
        try:
            with open(config_file) as f:
                custom_config = json.load(f)
                default_config.update(custom_config)
        except Exception as e:
            logger.warning(f"Failed to load config {config_name}: {e}")
    
    return default_config


async def run_discovery(discovery_id: str, request: DiscoveryRequest):
    """
    Run the actual discovery using Playwright.
    """
    from playwright.async_api import async_playwright
    
    discovery_dir = DATA_DIR / discovery_id
    discovery_dir.mkdir(parents=True, exist_ok=True)
    
    result = {
        "discovery_id": discovery_id,
        "status": "running",
        "ui_url": request.ui_url,
        "started_at": datetime.utcnow().isoformat() + "Z",
        "completed_at": None,
        "login_success": False,
        "pages": [],
        "navigation_items": [],
        "api_endpoints": [],
        "forms_found": [],
        "error": None
    }
    
    # Update status
    _discoveries[discovery_id]["status"] = "running"
    
    config = get_login_config(request.config_name)
    api_requests: Set[str] = set()
    discovered_urls: Set[str] = set()
    
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                viewport={"width": 1920, "height": 1080},
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            )
            
            # Set up network request interception
            page = await context.new_page()
            
            async def handle_request(request):
                url = request.url
                # Capture API-like requests
                if any(pattern in url for pattern in ['/api/', '/v1/', '/v2/', '/graphql', '/rest/']):
                    api_requests.add(json.dumps({
                        "url": url,
                        "method": request.method,
                        "resource_type": request.resource_type
                    }))
            
            page.on("request", handle_request)
            
            # Step 1: Open the UI URL
            logger.info(f"[{discovery_id}] Opening {request.ui_url}")
            await page.goto(request.ui_url, timeout=request.timeout, wait_until="networkidle")
            
            # Take screenshot of login page
            await page.screenshot(path=str(discovery_dir / "01_login_page.png"))
            
            # Step 2: Try to login
            logger.info(f"[{discovery_id}] Attempting login...")
            
            # Find and fill username
            username_filled = False
            for selector in config["username_selector"].split(", "):
                try:
                    elem = page.locator(selector).first
                    if await elem.count() > 0:
                        await elem.fill(request.username)
                        username_filled = True
                        logger.info(f"[{discovery_id}] Filled username using: {selector}")
                        break
                except Exception:
                    continue
            
            # Find and fill password
            password_filled = False
            for selector in config["password_selector"].split(", "):
                try:
                    elem = page.locator(selector).first
                    if await elem.count() > 0:
                        await elem.fill(request.password)
                        password_filled = True
                        logger.info(f"[{discovery_id}] Filled password using: {selector}")
                        break
                except Exception:
                    continue
            
            if username_filled and password_filled:
                # Click submit
                for selector in config["submit_selector"].split(", "):
                    try:
                        elem = page.locator(selector).first
                        if await elem.count() > 0:
                            await elem.click()
                            logger.info(f"[{discovery_id}] Clicked submit using: {selector}")
                            break
                    except Exception:
                        continue
                
                # Wait for navigation/login
                await asyncio.sleep(config.get("wait_after_login", 3000) / 1000)
                
                # Check if login was successful
                for selector in config["success_indicator"].split(", "):
                    try:
                        if await page.locator(selector).first.count() > 0:
                            result["login_success"] = True
                            logger.info(f"[{discovery_id}] Login successful! Found: {selector}")
                            break
                    except Exception:
                        continue
                
                # Take screenshot after login
                await page.screenshot(path=str(discovery_dir / "02_after_login.png"))
            
            # Step 3: Discover navigation items
            logger.info(f"[{discovery_id}] Discovering navigation...")
            nav_items = []
            
            for selector in config["nav_selector"].split(", "):
                try:
                    links = page.locator(selector)
                    count = await links.count()
                    
                    for i in range(min(count, 50)):  # Limit to 50 nav items
                        try:
                            link = links.nth(i)
                            href = await link.get_attribute("href")
                            text = await link.inner_text()
                            
                            if href and text.strip():
                                full_url = urljoin(request.ui_url, href)
                                if full_url not in discovered_urls:
                                    nav_items.append({
                                        "text": text.strip()[:100],
                                        "href": href,
                                        "full_url": full_url
                                    })
                                    discovered_urls.add(full_url)
                        except Exception:
                            continue
                except Exception:
                    continue
            
            result["navigation_items"] = nav_items
            logger.info(f"[{discovery_id}] Found {len(nav_items)} navigation items")
            
            # Step 4: Crawl each discovered page
            base_domain = urlparse(request.ui_url).netloc
            pages_crawled = 0
            
            for nav_item in nav_items[:request.max_pages]:
                try:
                    url = nav_item["full_url"]
                    
                    # Only crawl same-domain URLs
                    if urlparse(url).netloc != base_domain:
                        continue
                    
                    logger.info(f"[{discovery_id}] Crawling: {url}")
                    await page.goto(url, timeout=request.timeout, wait_until="networkidle")
                    
                    # Get page info
                    title = await page.title()
                    
                    # Find forms on the page
                    forms = []
                    form_elements = page.locator("form")
                    form_count = await form_elements.count()
                    
                    for i in range(min(form_count, 10)):
                        try:
                            form = form_elements.nth(i)
                            action = await form.get_attribute("action") or ""
                            method = await form.get_attribute("method") or "GET"
                            
                            # Get form inputs
                            inputs = []
                            input_elements = form.locator("input, select, textarea")
                            input_count = await input_elements.count()
                            
                            for j in range(min(input_count, 20)):
                                try:
                                    inp = input_elements.nth(j)
                                    inp_type = await inp.get_attribute("type") or "text"
                                    inp_name = await inp.get_attribute("name") or ""
                                    inp_placeholder = await inp.get_attribute("placeholder") or ""
                                    
                                    if inp_type not in ["hidden", "submit"]:
                                        inputs.append({
                                            "type": inp_type,
                                            "name": inp_name,
                                            "placeholder": inp_placeholder
                                        })
                                except Exception:
                                    continue
                            
                            if inputs:
                                forms.append({
                                    "action": action,
                                    "method": method.upper(),
                                    "inputs": inputs,
                                    "page_url": url
                                })
                        except Exception:
                            continue
                    
                    # Find buttons
                    buttons = []
                    button_elements = page.locator("button, input[type='submit'], input[type='button']")
                    button_count = await button_elements.count()
                    
                    for i in range(min(button_count, 20)):
                        try:
                            btn = button_elements.nth(i)
                            btn_text = await btn.inner_text()
                            btn_type = await btn.get_attribute("type") or "button"
                            
                            if btn_text.strip():
                                buttons.append({
                                    "text": btn_text.strip()[:50],
                                    "type": btn_type
                                })
                        except Exception:
                            continue
                    
                    # Add page info
                    page_info = {
                        "url": url,
                        "title": title,
                        "forms_count": len(forms),
                        "buttons_count": len(buttons),
                        "buttons": buttons[:10]
                    }
                    result["pages"].append(page_info)
                    result["forms_found"].extend(forms)
                    
                    pages_crawled += 1
                    _discoveries[discovery_id]["pages_discovered"] = pages_crawled
                    
                    # Take screenshot
                    safe_name = "".join(c if c.isalnum() else "_" for c in nav_item["text"][:30])
                    await page.screenshot(path=str(discovery_dir / f"page_{pages_crawled:02d}_{safe_name}.png"))
                    
                except Exception as e:
                    logger.warning(f"[{discovery_id}] Failed to crawl {url}: {e}")
                    continue
            
            await browser.close()
        
        # Step 5: Process captured API endpoints
        api_list = []
        for req_json in api_requests:
            try:
                req = json.loads(req_json)
                api_list.append(req)
            except Exception:
                continue
        
        result["api_endpoints"] = api_list
        result["status"] = "completed"
        result["completed_at"] = datetime.utcnow().isoformat() + "Z"
        
        _discoveries[discovery_id]["status"] = "completed"
        _discoveries[discovery_id]["api_endpoints_found"] = len(api_list)
        
        logger.info(f"[{discovery_id}] Discovery completed! Pages: {len(result['pages'])}, APIs: {len(api_list)}")
        
    except Exception as e:
        logger.error(f"[{discovery_id}] Discovery failed: {e}", exc_info=True)
        result["status"] = "failed"
        result["error"] = str(e)
        result["completed_at"] = datetime.utcnow().isoformat() + "Z"
        _discoveries[discovery_id]["status"] = "failed"
        _discoveries[discovery_id]["error"] = str(e)
    
    # Save results to file
    output_file = discovery_dir / "discovery.json"
    with open(output_file, "w") as f:
        json.dump(result, f, indent=2)
    
    logger.info(f"[{discovery_id}] Results saved to {output_file}")
    return result


@router.post("/discover", response_model=DiscoveryStatus)
async def start_discovery(request: DiscoveryRequest, background_tasks: BackgroundTasks):
    """
    Start a new discovery session.
    
    This will:
    1. Open the UI URL in a headless browser
    2. Login using the provided credentials
    3. Crawl navigation menu items
    4. Capture network requests to build API list
    5. Save results to /data/{discovery_id}/discovery.json
    """
    discovery_id = str(uuid.uuid4())[:12]
    
    # Initialize discovery record
    _discoveries[discovery_id] = {
        "discovery_id": discovery_id,
        "status": "pending",
        "ui_url": request.ui_url,
        "started_at": datetime.utcnow().isoformat() + "Z",
        "completed_at": None,
        "pages_discovered": 0,
        "api_endpoints_found": 0,
        "error": None
    }
    
    # Start discovery in background
    background_tasks.add_task(run_discovery, discovery_id, request)
    
    logger.info(f"Started discovery {discovery_id} for {request.ui_url}")
    
    return DiscoveryStatus(**_discoveries[discovery_id])


@router.get("/discover/{discovery_id}", response_model=DiscoveryResult)
async def get_discovery(discovery_id: str):
    """
    Get discovery results.
    
    Returns discovered pages, navigation items, forms, and API endpoints.
    """
    # Check if discovery exists
    if discovery_id not in _discoveries:
        # Try to load from file
        discovery_file = DATA_DIR / discovery_id / "discovery.json"
        if discovery_file.exists():
            with open(discovery_file) as f:
                return DiscoveryResult(**json.load(f))
        raise HTTPException(status_code=404, detail=f"Discovery {discovery_id} not found")
    
    # If still running, return status
    status = _discoveries[discovery_id]
    if status["status"] in ["pending", "running"]:
        return DiscoveryResult(
            discovery_id=discovery_id,
            status=status["status"],
            ui_url=status["ui_url"],
            started_at=status["started_at"],
            pages=[],
            navigation_items=[],
            api_endpoints=[],
            forms_found=[]
        )
    
    # Load completed results from file
    discovery_file = DATA_DIR / discovery_id / "discovery.json"
    if discovery_file.exists():
        with open(discovery_file) as f:
            return DiscoveryResult(**json.load(f))
    
    # Fallback to in-memory data
    return DiscoveryResult(
        discovery_id=discovery_id,
        status=status["status"],
        ui_url=status["ui_url"],
        started_at=status["started_at"],
        completed_at=status.get("completed_at"),
        error=status.get("error"),
        pages=[],
        navigation_items=[],
        api_endpoints=[],
        forms_found=[]
    )


@router.get("/discoveries")
async def list_discoveries():
    """
    List all discovery sessions.
    """
    discoveries = []
    
    # From memory
    for disc_id, disc in _discoveries.items():
        discoveries.append({
            "discovery_id": disc_id,
            "status": disc["status"],
            "ui_url": disc["ui_url"],
            "started_at": disc["started_at"],
            "pages_discovered": disc.get("pages_discovered", 0),
            "api_endpoints_found": disc.get("api_endpoints_found", 0)
        })
    
    # From disk (for restarted server)
    if DATA_DIR.exists():
        for dir_path in DATA_DIR.iterdir():
            if dir_path.is_dir() and dir_path.name not in _discoveries:
                discovery_file = dir_path / "discovery.json"
                if discovery_file.exists():
                    try:
                        with open(discovery_file) as f:
                            data = json.load(f)
                            discoveries.append({
                                "discovery_id": data["discovery_id"],
                                "status": data["status"],
                                "ui_url": data["ui_url"],
                                "started_at": data["started_at"],
                                "pages_discovered": len(data.get("pages", [])),
                                "api_endpoints_found": len(data.get("api_endpoints", []))
                            })
                    except Exception:
                        continue
    
    return {"discoveries": discoveries}
