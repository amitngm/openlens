"""
QA Buddy V2 - Whiteboard Flow Implementation

Simple 5-step flow:
S1: Login Flow
S2: Trace all pages to know all Paths
S3: Should know access to perform action
S4: Check health of app. by clicking all pages
S5: Now everything fine, ask to test what
"""

import os
import json
import uuid
import asyncio
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List
from urllib.parse import urlparse, urljoin

from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

try:
    from playwright.async_api import async_playwright
except ImportError:
    async_playwright = None

logger = logging.getLogger(__name__)

# =============================================================================
# Configuration
# =============================================================================

DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

ALLOW_PROD = os.getenv("ALLOW_PROD", "false").lower() == "true"
PROD_PATTERNS = ["prod", "production", "live", "prd"]

router = APIRouter(prefix="/qa-buddy-v2", tags=["QA Buddy V2"])

# State
_qa_buddy_v2_discoveries: Dict[str, Dict] = {}

# Login Configs
LOGIN_CONFIGS = {
    "default": {
        "username_selector": "input[name='username'], input[name='email'], input[type='email'], #username, #email",
        "password_selector": "input[name='password'], input[type='password'], #password",
        "submit_selector": "button[type='submit'], input[type='submit'], #kc-login, button:has-text('Sign in'), button:has-text('Log in')",
        "success_indicator": "nav, .sidebar, .menu, .dashboard, .home, [data-logged-in]",
        "wait_after_login": 3000
    },
    "keycloak": {
        "username_selector": "#username, input[name='username']",
        "password_selector": "#password, input[name='password']",
        "submit_selector": "#kc-login, button[type='submit']",
        "success_indicator": "nav, .sidebar, .menu, .dashboard",
        "wait_after_login": 3000
    }
}


def safe_log(message: str, data: Optional[Dict] = None):
    """Safe logging that redacts secrets."""
    if data:
        safe_data = {k: v for k, v in data.items() if "password" not in k.lower() and "secret" not in k.lower()}
        logger.info(f"{message} {json.dumps(safe_data)}")
    else:
        logger.info(message)


def is_production(url: str, env: str) -> bool:
    """Check if environment is production."""
    if env.lower() in PROD_PATTERNS:
        return True
    return any(p in url.lower() for p in PROD_PATTERNS)


# =============================================================================
# Models
# =============================================================================

class QABuddyV2DiscoverRequest(BaseModel):
    """QA Buddy V2 discovery request."""
    application_url: str
    username: Optional[str] = None
    password: Optional[str] = None
    env: str = "staging"
    config_name: str = "keycloak"
    test_prompt: Optional[str] = None  # For S5


class QABuddyV2TestRequest(BaseModel):
    """QA Buddy V2 test execution request."""
    discovery_id: str
    test_prompt: str
    test_type: Optional[str] = None  # "form_validation", "api_check", "navigation", etc.


# =============================================================================
# S1: Login Flow
# =============================================================================

async def step1_login_flow(
    page,
    application_url: str,
    username: Optional[str],
    password: Optional[str],
    config_name: str,
    discovery_dir: Path,
    emit_event=None
) -> Dict[str, Any]:
    """
    S1: Login Flow
    - Navigate to application URL
    - Detect Keycloak redirect
    - Fill credentials and submit
    - Wait for redirect back to application
    - Verify login success
    """
    try:
        if emit_event:
            await emit_event({
                "event": "S1_START",
                "data": {"message": "Starting login flow", "url": application_url}
            })
        
        safe_log(f"[S1] Navigating to application: {application_url}")
        
        # Navigate to application (will redirect to Keycloak if not logged in)
        await page.goto(application_url, timeout=30000, wait_until="networkidle")
        await asyncio.sleep(2)  # Wait for page to stabilize
        
        current_url = page.url
        safe_log(f"[S1] Current URL after navigation: {current_url}")
        
        # Check if we were redirected to Keycloak
        is_keycloak_redirect = "keycloak" in current_url.lower() or "auth" in current_url.lower()
        
        if emit_event:
            await emit_event({
                "event": "S1_REDIRECT_DETECTED",
                "data": {
                    "is_keycloak": is_keycloak_redirect,
                    "current_url": current_url
                }
            })
        
        # If no credentials provided and we're on login page, return needs login
        if not username or not password:
            # Check if we're on a login page
            login_selectors = [
                "input[name='username']", "input[name='email']",
                "input[type='email']", "#username", "#email"
            ]
            is_login_page = False
            for selector in login_selectors:
                try:
                    if await page.locator(selector).first.count() > 0:
                        is_login_page = True
                        break
                except:
                    continue
            
            if is_login_page:
                return {
                    "status": "needs_login",
                    "session_valid": False,
                    "message": "Login page detected but no credentials provided"
                }
            else:
                # Assume already logged in
                return {
                    "status": "success",
                    "session_valid": True,
                    "message": "No login required or already logged in"
                }
        
        # Perform login
        config = LOGIN_CONFIGS.get(config_name, LOGIN_CONFIGS["default"])
        
        # Take screenshot before login
        if discovery_dir:
            await page.screenshot(path=str(discovery_dir / "s1_before_login.png"))
        
        # Fill username
        username_filled = False
        for selector in config["username_selector"].split(", "):
            try:
                selector = selector.strip()
                if await page.locator(selector).first.count() > 0:
                    await page.locator(selector).first.fill(username)
                    username_filled = True
                    safe_log(f"[S1] Filled username using: {selector}")
                    break
            except Exception as e:
                continue
        
        if not username_filled:
            return {
                "status": "failed",
                "session_valid": False,
                "message": "Cannot find username field"
            }
        
        # Fill password
        password_filled = False
        for selector in config["password_selector"].split(", "):
            try:
                selector = selector.strip()
                if await page.locator(selector).first.count() > 0:
                    await page.locator(selector).first.fill(password)
                    password_filled = True
                    safe_log(f"[S1] Filled password using: {selector}")
                    break
            except Exception as e:
                continue
        
        if not password_filled:
            return {
                "status": "failed",
                "session_valid": False,
                "message": "Cannot find password field"
            }
        
        # Submit login
        submit_clicked = False
        for selector in config["submit_selector"].split(", "):
            try:
                selector = selector.strip()
                if await page.locator(selector).first.count() > 0:
                    # Wait for navigation after submit (Keycloak redirects back to UI)
                    try:
                        async with page.expect_navigation(timeout=30000, wait_until="networkidle"):
                            await page.locator(selector).first.click()
                        submit_clicked = True
                        safe_log(f"[S1] Clicked submit, waiting for redirect")
                        break
                    except asyncio.TimeoutError:
                        await page.locator(selector).first.click()
                        submit_clicked = True
                        break
            except Exception as e:
                continue
        
        if not submit_clicked:
            return {
                "status": "failed",
                "session_valid": False,
                "message": "Cannot find submit button"
            }
        
        # Wait for redirect back to UI (Keycloak redirects after successful login)
        await asyncio.sleep(3)  # Initial wait
        
        try:
            await page.wait_for_load_state("networkidle", timeout=20000)
            await asyncio.sleep(2)
        except:
            await asyncio.sleep(2)
        
        # Check current URL after login
        current_url_after = page.url
        safe_log(f"[S1] URL after login: {current_url_after}")
        
        # Check if we're back on application domain (not Keycloak)
        application_domain = urlparse(application_url).netloc
        current_domain = urlparse(current_url_after).netloc
        is_still_on_keycloak = "keycloak" in current_url_after.lower() or ("auth" in current_url_after.lower() and "login" in current_url_after.lower())
        
        if is_still_on_keycloak:
            safe_log(f"[S1] Still on Keycloak, navigating back to application")
            try:
                await page.goto(application_url, timeout=30000, wait_until="networkidle")
                await asyncio.sleep(2)
                current_url_after = page.url
            except Exception as e:
                safe_log(f"[S1] Failed to navigate back: {e}")
        
        # Take screenshot after login
        if discovery_dir:
            await page.screenshot(path=str(discovery_dir / "s1_after_login.png"))
        
        # Verify login success - check for logged-in markers
        success_indicators = config["success_indicator"].split(", ")
        login_markers = [
            "nav", ".sidebar", ".menu", "[role='navigation']", "aside",
            "button:has-text('Logout')", "button:has-text('Sign out')",
            ".dashboard", ".home"
        ]
        
        all_indicators = success_indicators + login_markers
        login_success = False
        found_markers = []
        
        for selector in all_indicators:
            try:
                selector = selector.strip()
                count = await page.locator(selector).first.count()
                if count > 0:
                    login_success = True
                    found_markers.append(selector)
                    break
            except:
                continue
        
        # Also check if still on login page
        still_on_login = "login" in current_url_after.lower() or "signin" in current_url_after.lower()
        
        if still_on_login and not login_success:
            return {
                "status": "failed",
                "session_valid": False,
                "message": "Still on login page after submit. Check credentials."
            }
        
        if login_success:
            if emit_event:
                await emit_event({
                    "event": "S1_SUCCESS",
                    "data": {
                        "message": "Login successful",
                        "markers_found": found_markers[:3],
                        "final_url": current_url_after
                    }
                })
            
            return {
                "status": "success",
                "session_valid": True,
                "message": "Login successful",
                "final_url": current_url_after,
                "markers_found": found_markers
            }
        else:
            return {
                "status": "warning",
                "session_valid": True,  # Assume valid if not on login page
                "message": "Login completed but no clear logged-in markers found",
                "final_url": current_url_after
            }
    
    except Exception as e:
        safe_log(f"[S1] Login flow error: {e}")
        return {
            "status": "failed",
            "session_valid": False,
            "message": f"Login flow error: {str(e)[:200]}"
        }


# =============================================================================
# S2: Trace All Pages
# =============================================================================

async def step2_trace_pages(
    page,
    application_url: str,
    discovery_dir: Path,
    emit_event=None
) -> Dict[str, Any]:
    """
    S2: Trace all pages to know all Paths
    - Start from logged-in homepage
    - Find all navigation links
    - Visit each page and extract metadata
    - Build complete page map
    """
    try:
        if emit_event:
            await emit_event({
                "event": "S2_START",
                "data": {"message": "Starting page tracing"}
            })
        
        safe_log(f"[S2] Starting page tracing from: {application_url}")
        
        # Start from current page (should be logged-in homepage)
        base_url = application_url
        base_domain = urlparse(base_url).netloc
        
        # Find all navigation elements
        nav_selectors = [
            "nav a",
            ".sidebar a",
            ".menu a",
            "[role='navigation'] a",
            "aside a",
            ".nav-link",
            ".menu-item a",
            "[data-testid*='nav'] a",
            "header a",
            ".breadcrumb a"
        ]
        
        all_links = []
        seen_urls = set()
        
        # Collect links from all navigation selectors
        for selector in nav_selectors:
            try:
                links = page.locator(selector)
                count = await links.count()
                for i in range(min(count, 50)):  # Limit to 50 per selector
                    try:
                        link = links.nth(i)
                        href = await link.get_attribute("href")
                        text = await link.inner_text()
                        
                        if not href or not text.strip():
                            continue
                        
                        # Build full URL
                        if href.startswith("http"):
                            full_url = href
                        else:
                            full_url = urljoin(base_url, href)
                        
                        # Only include same-domain URLs
                        link_domain = urlparse(full_url).netloc
                        if link_domain != base_domain:
                            continue
                        
                        # Deduplicate
                        if full_url not in seen_urls:
                            seen_urls.add(full_url)
                            all_links.append({
                                "url": full_url,
                                "text": text.strip()[:100],
                                "selector": selector
                            })
                    except:
                        continue
            except:
                continue
        
        safe_log(f"[S2] Found {len(all_links)} navigation links")
        
        if emit_event:
            await emit_event({
                "event": "S2_LINKS_FOUND",
                "data": {"count": len(all_links)}
            })
        
        # Visit each page and extract metadata
        pages = []
        max_pages = 30  # Limit to prevent timeout
        
        for idx, link_info in enumerate(all_links[:max_pages]):
            try:
                url = link_info["url"]
                safe_log(f"[S2] Visiting page {idx+1}/{min(len(all_links), max_pages)}: {url}")
                
                await page.goto(url, timeout=30000, wait_until="networkidle")
                await asyncio.sleep(1)  # Brief wait for page to stabilize
                
                # Extract page metadata
                title = await page.title()
                current_url = page.url
                
                # Detect page structure
                has_form = await page.locator("form").count() > 0
                has_table = await page.locator("table").count() > 0
                button_count = await page.locator("button").count()
                link_count = await page.locator("a").count()
                
                # Detect page type
                page_type = "unknown"
                if has_form and not has_table:
                    page_type = "form"
                elif has_table and not has_form:
                    page_type = "list"
                elif has_form and has_table:
                    page_type = "crud"
                elif "dashboard" in current_url.lower() or "home" in current_url.lower():
                    page_type = "dashboard"
                else:
                    page_type = "detail"
                
                page_info = {
                    "url": current_url,
                    "title": title,
                    "nav_text": link_info["text"],
                    "page_type": page_type,
                    "has_form": has_form,
                    "has_table": has_table,
                    "button_count": button_count,
                    "link_count": link_count,
                    "index": idx + 1
                }
                
                pages.append(page_info)
                
                if emit_event:
                    await emit_event({
                        "event": "S2_PAGE_DISCOVERED",
                        "data": {
                            "index": idx + 1,
                            "total": min(len(all_links), max_pages),
                            "url": current_url,
                            "title": title,
                            "type": page_type
                        }
                    })
                
                # Take screenshot
                if discovery_dir:
                    screenshot_path = discovery_dir / f"s2_page_{idx+1}.png"
                    await page.screenshot(path=str(screenshot_path))
                    page_info["screenshot"] = str(screenshot_path)
                
            except Exception as e:
                safe_log(f"[S2] Failed to visit {link_info.get('url', 'unknown')}: {e}")
                continue
        
        safe_log(f"[S2] Traced {len(pages)} pages")
        
        if emit_event:
            await emit_event({
                "event": "S2_COMPLETE",
                "data": {
                    "total_pages": len(pages),
                    "total_paths": len(all_links)
                }
            })
        
        return {
            "status": "success",
            "pages": pages,
            "total_paths": len(all_links),
            "pages_visited": len(pages)
        }
    
    except Exception as e:
        safe_log(f"[S2] Page tracing error: {e}")
        return {
            "status": "failed",
            "pages": [],
            "total_paths": 0,
            "error": str(e)[:200]
        }


# =============================================================================
# S3: Know Access to Perform Action
# =============================================================================

async def step3_detect_access(
    page,
    pages: List[Dict[str, Any]],
    discovery_dir: Path,
    emit_event=None
) -> Dict[str, Any]:
    """
    S3: Should know access to perform action
    - For each page, detect visible actions
    - Detect disabled/hidden elements (permission-based)
    - Map user capabilities
    """
    try:
        if emit_event:
            await emit_event({
                "event": "S3_START",
                "data": {"message": "Detecting user access and permissions"}
            })
        
        safe_log(f"[S3] Detecting access for {len(pages)} pages")
        
        user_permissions = {}
        accessible_pages = []
        actions_map = {}
        total_actions = 0
        
        for page_info in pages:
            try:
                url = page_info["url"]
                safe_log(f"[S3] Checking access for: {url}")
                
                await page.goto(url, timeout=30000, wait_until="networkidle")
                await asyncio.sleep(1)
                
                # Find all visible buttons/actions
                visible_buttons = []
                button_selectors = [
                    "button:not([disabled])",
                    "a[role='button']:not([disabled])",
                    "input[type='submit']:not([disabled])",
                    "[data-testid*='button']:not([disabled])"
                ]
                
                for selector in button_selectors:
                    try:
                        buttons = page.locator(selector)
                        count = await buttons.count()
                        for i in range(min(count, 20)):
                            try:
                                button = buttons.nth(i)
                                text = await button.inner_text()
                                is_visible = await button.is_visible()
                                if is_visible and text.strip():
                                    visible_buttons.append({
                                        "text": text.strip()[:50],
                                        "selector": selector
                                    })
                            except:
                                continue
                    except:
                        continue
                
                # Find disabled buttons (permission denied)
                disabled_buttons = []
                try:
                    disabled = page.locator("button[disabled], a[disabled], input[type='submit'][disabled]")
                    count = await disabled.count()
                    for i in range(min(count, 10)):
                        try:
                            btn = disabled.nth(i)
                            text = await btn.inner_text()
                            if text.strip():
                                disabled_buttons.append(text.strip()[:50])
                        except:
                            continue
                except:
                    pass
                
                # Check for error messages (access denied)
                error_messages = []
                error_selectors = [
                    ":has-text('access denied')",
                    ":has-text('permission denied')",
                    ":has-text('403')",
                    ":has-text('unauthorized')",
                    ".error-message",
                    "[role='alert']"
                ]
                
                for selector in error_selectors:
                    try:
                        errors = page.locator(selector)
                        count = await errors.count()
                        if count > 0:
                            for i in range(min(count, 3)):
                                try:
                                    error_text = await errors.nth(i).inner_text()
                                    if error_text.strip():
                                        error_messages.append(error_text.strip()[:100])
                                except:
                                    continue
                    except:
                        continue
                
                # Check if page is read-only (has forms but no submit buttons)
                has_form = page_info.get("has_form", False)
                has_submit = await page.locator("button[type='submit'], input[type='submit']").count() > 0
                is_read_only = has_form and not has_submit
                
                # Build action map for this page
                page_actions = {
                    "visible_actions": visible_buttons[:10],  # Limit to 10
                    "disabled_actions": disabled_buttons,
                    "error_messages": error_messages,
                    "is_read_only": is_read_only,
                    "can_edit": has_submit and not is_read_only,
                    "can_view": True  # If we can visit, we can view
                }
                
                actions_map[url] = page_actions
                accessible_pages.append({
                    "url": url,
                    "title": page_info.get("title", ""),
                    "accessible": len(error_messages) == 0,
                    "actions_count": len(visible_buttons),
                    "read_only": is_read_only
                })
                
                total_actions += len(visible_buttons)
                
                if emit_event:
                    await emit_event({
                        "event": "S3_PAGE_ANALYZED",
                        "data": {
                            "url": url,
                            "actions_count": len(visible_buttons),
                            "read_only": is_read_only,
                            "accessible": len(error_messages) == 0
                        }
                    })
                
            except Exception as e:
                safe_log(f"[S3] Failed to analyze {page_info.get('url', 'unknown')}: {e}")
                continue
        
        safe_log(f"[S3] Detected access for {len(accessible_pages)} pages, {total_actions} total actions")
        
        if emit_event:
            await emit_event({
                "event": "S3_COMPLETE",
                "data": {
                    "accessible_pages": len(accessible_pages),
                    "total_actions": total_actions
                }
            })
        
        return {
            "status": "success",
            "user_permissions": {
                "can_view": len(accessible_pages),
                "can_edit": sum(1 for p in accessible_pages if not p.get("read_only", True)),
                "read_only_pages": sum(1 for p in accessible_pages if p.get("read_only", False))
            },
            "accessible_pages": accessible_pages,
            "actions_map": actions_map,
            "total_actions": total_actions
        }
    
    except Exception as e:
        safe_log(f"[S3] Access detection error: {e}")
        return {
            "status": "failed",
            "user_permissions": {},
            "accessible_pages": [],
            "actions_map": {},
            "error": str(e)[:200]
        }


# =============================================================================
# S4: Health Check by Clicking All Pages
# =============================================================================

async def step4_health_check(
    page,
    pages: List[Dict[str, Any]],
    discovery_dir: Path,
    emit_event=None
) -> Dict[str, Any]:
    """
    S4: Check health of app. by clicking all pages
    - Visit each discovered page
    - Click through navigation
    - Check for errors (console, network, page load)
    - Capture evidence
    """
    try:
        if emit_event:
            await emit_event({
                "event": "S4_START",
                "data": {"message": "Starting health check", "pages_count": len(pages)}
            })
        
        safe_log(f"[S4] Starting health check for {len(pages)} pages")
        
        # Setup network monitoring
        network_errors = []
        console_errors = []
        slow_requests = []
        
        def capture_response(response):
            try:
                status = response.status
                url = response.url
                
                if status >= 400:
                    network_errors.append({
                        "url": url,
                        "status": status,
                        "type": "4xx" if status < 500 else "5xx"
                    })
                
                # Check for slow requests (>3 seconds)
                try:
                    timing = response.request.timing
                    if timing:
                        duration = timing.get("responseEnd", 0) - timing.get("requestStart", 0)
                        if duration > 3000:
                            slow_requests.append({
                                "url": url,
                                "duration_ms": duration
                            })
                except:
                    pass
            except:
                pass
        
        def capture_console(msg):
            if msg.type == "error":
                console_errors.append({
                    "text": msg.text[:200],
                    "type": msg.type
                })
        
        page.on("response", capture_response)
        page.on("console", capture_console)
        
        page_health = []
        total_issues = 0
        
        for idx, page_info in enumerate(pages):
            try:
                url = page_info["url"]
                safe_log(f"[S4] Health checking page {idx+1}/{len(pages)}: {url}")
                
                # Clear previous errors for this page
                page_network_errors = []
                page_console_errors = []
                
                start_time = asyncio.get_event_loop().time()
                
                await page.goto(url, timeout=30000, wait_until="networkidle")
                
                load_time = (asyncio.get_event_loop().time() - start_time) * 1000
                
                await asyncio.sleep(1)
                
                # Check page load success
                current_url = page.url
                page_loads = current_url == url or url in current_url
                
                # Check for visible errors on page
                visible_errors = []
                error_selectors = [
                    ".error",
                    ".alert-danger",
                    "[role='alert']",
                    ":has-text('error')",
                    ":has-text('failed')"
                ]
                
                for selector in error_selectors:
                    try:
                        errors = page.locator(selector)
                        count = await errors.count()
                        if count > 0:
                            for i in range(min(count, 3)):
                                try:
                                    error_text = await errors.nth(i).inner_text()
                                    if error_text.strip():
                                        visible_errors.append(error_text.strip()[:100])
                                except:
                                    continue
                    except:
                        continue
                
                # Check if forms render correctly
                forms_render = True
                if page_info.get("has_form", False):
                    try:
                        form_count = await page.locator("form").count()
                        forms_render = form_count > 0
                    except:
                        forms_render = False
                
                # Check if tables load data
                tables_load = True
                if page_info.get("has_table", False):
                    try:
                        table_count = await page.locator("table").count()
                        if table_count > 0:
                            # Check if table has rows
                            row_count = await page.locator("table tbody tr").count()
                            tables_load = row_count >= 0  # 0 rows is still valid
                        else:
                            tables_load = False
                    except:
                        tables_load = False
                
                # Collect errors for this page
                page_issues = []
                if not page_loads:
                    page_issues.append({"type": "page_load_failed", "message": "Page did not load correctly"})
                if visible_errors:
                    page_issues.append({"type": "visible_errors", "errors": visible_errors})
                if not forms_render and page_info.get("has_form"):
                    page_issues.append({"type": "form_not_rendered", "message": "Form expected but not found"})
                if not tables_load and page_info.get("has_table"):
                    page_issues.append({"type": "table_not_loaded", "message": "Table expected but not loaded"})
                if load_time > 5000:
                    page_issues.append({"type": "slow_load", "message": f"Page took {load_time:.0f}ms to load"})
                
                total_issues += len(page_issues)
                
                # Determine health status for this page
                if len(page_issues) == 0:
                    health_status = "healthy"
                elif len(page_issues) <= 2:
                    health_status = "degraded"
                else:
                    health_status = "unhealthy"
                
                page_health.append({
                    "url": url,
                    "title": page_info.get("title", ""),
                    "health_status": health_status,
                    "load_time_ms": load_time,
                    "page_loads": page_loads,
                    "forms_render": forms_render,
                    "tables_load": tables_load,
                    "issues": page_issues,
                    "issues_count": len(page_issues)
                })
                
                # Take screenshot
                if discovery_dir:
                    screenshot_path = discovery_dir / f"s4_health_{idx+1}.png"
                    await page.screenshot(path=str(screenshot_path))
                    page_health[-1]["screenshot"] = str(screenshot_path)
                
                if emit_event:
                    await emit_event({
                        "event": "S4_PAGE_CHECKED",
                        "data": {
                            "index": idx + 1,
                            "total": len(pages),
                            "url": url,
                            "health_status": health_status,
                            "issues_count": len(page_issues)
                        }
                    })
                
            except Exception as e:
                safe_log(f"[S4] Failed to health check {page_info.get('url', 'unknown')}: {e}")
                page_health.append({
                    "url": page_info.get("url", "unknown"),
                    "health_status": "error",
                    "error": str(e)[:200]
                })
                total_issues += 1
                continue
        
        # Determine overall health status
        healthy_pages = sum(1 for p in page_health if p.get("health_status") == "healthy")
        degraded_pages = sum(1 for p in page_health if p.get("health_status") == "degraded")
        unhealthy_pages = sum(1 for p in page_health if p.get("health_status") == "unhealthy")
        
        if unhealthy_pages == 0 and degraded_pages == 0:
            overall_health = "healthy"
        elif unhealthy_pages == 0:
            overall_health = "degraded"
        else:
            overall_health = "unhealthy"
        
        # Collect all issues
        all_issues = []
        for page_h in page_health:
            all_issues.extend(page_h.get("issues", []))
        
        safe_log(f"[S4] Health check complete: {overall_health} ({healthy_pages} healthy, {degraded_pages} degraded, {unhealthy_pages} unhealthy)")
        
        if emit_event:
            await emit_event({
                "event": "S4_COMPLETE",
                "data": {
                    "health_status": overall_health,
                    "healthy_pages": healthy_pages,
                    "degraded_pages": degraded_pages,
                    "unhealthy_pages": unhealthy_pages,
                    "total_issues": total_issues
                }
            })
        
        return {
            "status": "success",
            "health_status": overall_health,
            "page_health": page_health,
            "issues": all_issues,
            "network_errors": network_errors[:20],  # Limit
            "console_errors": console_errors[:20],  # Limit
            "slow_requests": slow_requests[:20],  # Limit
            "summary": {
                "total_pages": len(pages),
                "healthy_pages": healthy_pages,
                "degraded_pages": degraded_pages,
                "unhealthy_pages": unhealthy_pages,
                "total_issues": total_issues
            }
        }
    
    except Exception as e:
        safe_log(f"[S4] Health check error: {e}")
        return {
            "status": "failed",
            "health_status": "error",
            "page_health": [],
            "issues": [],
            "error": str(e)[:200]
        }


# =============================================================================
# S5: Interactive Test Prompt
# =============================================================================

async def step5_execute_test_prompt(
    page,
    test_prompt: str,
    pages: List[Dict[str, Any]],
    access_result: Dict[str, Any],
    discovery_dir: Path,
    emit_event=None
) -> Dict[str, Any]:
    """
    S5: Now everything fine, ask to test what
    - Accept test instructions
    - Parse prompt (simple keyword matching for now)
    - Execute relevant tests
    - Return test results
    """
    try:
        if emit_event:
            await emit_event({
                "event": "S5_START",
                "data": {"message": "Executing test prompt", "prompt": test_prompt[:100]}
            })
        
        safe_log(f"[S5] Executing test prompt: {test_prompt}")
        
        test_prompt_lower = test_prompt.lower()
        test_results = []
        
        # Simple keyword-based test selection
        if "form" in test_prompt_lower or "submit" in test_prompt_lower:
            # Test forms
            for page_info in pages:
                if page_info.get("has_form", False):
                    try:
                        url = page_info["url"]
                        await page.goto(url, timeout=30000, wait_until="networkidle")
                        
                        # Check form fields
                        input_count = await page.locator("input, textarea, select").count()
                        submit_count = await page.locator("button[type='submit'], input[type='submit']").count()
                        
                        test_results.append({
                            "type": "form_validation",
                            "url": url,
                            "title": page_info.get("title", ""),
                            "passed": input_count > 0,
                            "details": {
                                "input_fields": input_count,
                                "submit_buttons": submit_count
                            }
                        })
                    except Exception as e:
                        test_results.append({
                            "type": "form_validation",
                            "url": page_info.get("url", ""),
                            "passed": False,
                            "error": str(e)[:200]
                        })
        
        if "navigation" in test_prompt_lower or "click" in test_prompt_lower or "link" in test_prompt_lower:
            # Test navigation
            tested_links = 0
            for page_info in pages[:10]:  # Limit to 10 pages
                try:
                    url = page_info["url"]
                    await page.goto(url, timeout=30000, wait_until="networkidle")
                    
                    # Click a few links on the page
                    links = page.locator("a")
                    link_count = await links.count()
                    clicked = 0
                    
                    for i in range(min(link_count, 5)):
                        try:
                            link = links.nth(i)
                            href = await link.get_attribute("href")
                            if href and not href.startswith("#"):
                                await link.click()
                                await asyncio.sleep(1)
                                clicked += 1
                                tested_links += 1
                        except:
                            continue
                    
                    test_results.append({
                        "type": "navigation",
                        "url": url,
                        "passed": clicked > 0,
                        "details": {"links_clicked": clicked}
                    })
                except Exception as e:
                    test_results.append({
                        "type": "navigation",
                        "url": page_info.get("url", ""),
                        "passed": False,
                        "error": str(e)[:200]
                    })
        
        if "table" in test_prompt_lower or "data" in test_prompt_lower:
            # Test tables
            for page_info in pages:
                if page_info.get("has_table", False):
                    try:
                        url = page_info["url"]
                        await page.goto(url, timeout=30000, wait_until="networkidle")
                        
                        table_count = await page.locator("table").count()
                        row_count = await page.locator("table tbody tr").count()
                        
                        test_results.append({
                            "type": "table_check",
                            "url": url,
                            "title": page_info.get("title", ""),
                            "passed": table_count > 0,
                            "details": {
                                "tables": table_count,
                                "rows": row_count
                            }
                        })
                    except Exception as e:
                        test_results.append({
                            "type": "table_check",
                            "url": page_info.get("url", ""),
                            "passed": False,
                            "error": str(e)[:200]
                        })
        
        # Default: if no specific keywords, run basic smoke tests
        if not test_results:
            for page_info in pages[:5]:  # Test first 5 pages
                try:
                    url = page_info["url"]
                    await page.goto(url, timeout=30000, wait_until="networkidle")
                    
                    # Basic checks
                    title = await page.title()
                    has_content = await page.locator("body").count() > 0
                    
                    test_results.append({
                        "type": "smoke_test",
                        "url": url,
                        "title": title,
                        "passed": has_content,
                        "details": {"has_title": bool(title), "has_content": has_content}
                    })
                except Exception as e:
                    test_results.append({
                        "type": "smoke_test",
                        "url": page_info.get("url", ""),
                        "passed": False,
                        "error": str(e)[:200]
                    })
        
        passed_tests = sum(1 for t in test_results if t.get("passed", False))
        total_tests = len(test_results)
        
        safe_log(f"[S5] Test execution complete: {passed_tests}/{total_tests} passed")
        
        if emit_event:
            await emit_event({
                "event": "S5_COMPLETE",
                "data": {
                    "total_tests": total_tests,
                    "passed_tests": passed_tests,
                    "failed_tests": total_tests - passed_tests
                }
            })
        
        return {
            "status": "success",
            "test_results": test_results,
            "summary": {
                "total_tests": total_tests,
                "passed": passed_tests,
                "failed": total_tests - passed_tests,
                "pass_rate": f"{(passed_tests / total_tests * 100):.1f}%" if total_tests > 0 else "N/A"
            }
        }
    
    except Exception as e:
        safe_log(f"[S5] Test execution error: {e}")
        return {
            "status": "failed",
            "test_results": [],
            "error": str(e)[:200]
        }


# =============================================================================
# Main Orchestrator: Run S1 → S2 → S3 → S4 → S5
# =============================================================================

async def run_qa_buddy_flow(
    discovery_id: str,
    request: QABuddyV2DiscoverRequest,
    emit_event=None
):
    """
    Main orchestrator that runs the 5-step flow sequentially.
    """
    discovery_dir = DATA_DIR / discovery_id
    discovery_dir.mkdir(parents=True, exist_ok=True)
    
    result = {
        "discovery_id": discovery_id,
        "status": "running",
        "current_stage": "S1",
        "started_at": datetime.utcnow().isoformat() + "Z",
        "completed_at": None,
        "s1_login": None,
        "s2_pages": None,
        "s3_access": None,
        "s4_health": None,
        "s5_tests": None,
        "error": None
    }
    
    _qa_buddy_v2_discoveries[discovery_id] = result
    
    try:
        if async_playwright is None:
            raise ImportError("Playwright not installed. Run: playwright install chromium")
        
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                viewport={"width": 1920, "height": 1080},
                ignore_https_errors=True
            )
            page = await context.new_page()
            
            try:
                # S1: Login Flow
                result["current_stage"] = "S1"
                safe_log(f"[{discovery_id}] Starting S1: Login Flow")
                
                login_result = await step1_login_flow(
                    page,
                    request.application_url,
                    request.username,
                    request.password,
                    request.config_name,
                    discovery_dir,
                    emit_event
                )
                
                result["s1_login"] = login_result
                
                if not login_result.get("session_valid", False):
                    result["status"] = "failed"
                    result["current_stage"] = "S1"
                    result["error"] = login_result.get("message", "Login failed")
                    result["completed_at"] = datetime.utcnow().isoformat() + "Z"
                    
                    with open(discovery_dir / "discovery.json", "w") as f:
                        json.dump(result, f, indent=2)
                    
                    await browser.close()
                    return result
                
                # S2: Trace All Pages
                result["current_stage"] = "S2"
                safe_log(f"[{discovery_id}] Starting S2: Trace All Pages")
                
                pages_result = await step2_trace_pages(
                    page,
                    request.application_url,
                    discovery_dir,
                    emit_event
                )
                
                result["s2_pages"] = pages_result
                
                if pages_result.get("status") != "success" or len(pages_result.get("pages", [])) == 0:
                    result["status"] = "failed"
                    result["current_stage"] = "S2"
                    result["error"] = "No pages discovered"
                    result["completed_at"] = datetime.utcnow().isoformat() + "Z"
                    
                    with open(discovery_dir / "discovery.json", "w") as f:
                        json.dump(result, f, indent=2)
                    
                    await browser.close()
                    return result
                
                # S3: Detect Access
                result["current_stage"] = "S3"
                safe_log(f"[{discovery_id}] Starting S3: Detect Access")
                
                access_result = await step3_detect_access(
                    page,
                    pages_result["pages"],
                    discovery_dir,
                    emit_event
                )
                
                result["s3_access"] = access_result
                
                # S4: Health Check
                result["current_stage"] = "S4"
                safe_log(f"[{discovery_id}] Starting S4: Health Check")
                
                health_result = await step4_health_check(
                    page,
                    pages_result["pages"],
                    discovery_dir,
                    emit_event
                )
                
                result["s4_health"] = health_result
                
                # S5: Test Prompt (if provided) or mark as ready
                if request.test_prompt:
                    result["current_stage"] = "S5"
                    safe_log(f"[{discovery_id}] Starting S5: Execute Test Prompt")
                    
                    test_result = await step5_execute_test_prompt(
                        page,
                        request.test_prompt,
                        pages_result["pages"],
                        access_result,
                        discovery_dir,
                        emit_event
                    )
                    
                    result["s5_tests"] = test_result
                else:
                    # Mark as ready for test prompt
                    result["current_stage"] = "S5"
                    result["s5_tests"] = {
                        "status": "awaiting_prompt",
                        "message": "Ready for test instructions. Use POST /qa-buddy-v2/discover/{id}/test"
                    }
                
                # All steps complete
                result["status"] = "completed"
                result["completed_at"] = datetime.utcnow().isoformat() + "Z"
                
                # Build summary
                result["summary"] = {
                    "pages_found": len(pages_result.get("pages", [])),
                    "actions_available": access_result.get("total_actions", 0),
                    "health_status": health_result.get("health_status", "unknown"),
                    "healthy_pages": health_result.get("summary", {}).get("healthy_pages", 0)
                }
                
                safe_log(f"[{discovery_id}] Flow complete: {result['status']}")
                
            except Exception as e:
                safe_log(f"[{discovery_id}] Flow error: {e}")
                result["status"] = "failed"
                result["error"] = str(e)[:200]
                result["completed_at"] = datetime.utcnow().isoformat() + "Z"
            
            finally:
                await browser.close()
        
        # Save final result
        with open(discovery_dir / "discovery.json", "w") as f:
            json.dump(result, f, indent=2)
        
        _qa_buddy_v2_discoveries[discovery_id] = result
        
        return result
    
    except Exception as e:
        safe_log(f"[{discovery_id}] Fatal error: {e}")
        result["status"] = "failed"
        result["error"] = str(e)[:200]
        result["completed_at"] = datetime.utcnow().isoformat() + "Z"
        
        with open(discovery_dir / "discovery.json", "w") as f:
            json.dump(result, f, indent=2)
        
        _qa_buddy_v2_discoveries[discovery_id] = result
        return result


# =============================================================================
# API Endpoints
# =============================================================================

@router.post("/discover")
async def start_discovery(request: QABuddyV2DiscoverRequest, background_tasks: BackgroundTasks):
    """
    Start QA Buddy V2 discovery flow (S1 → S2 → S3 → S4 → S5).
    
    Returns discovery_id immediately, flow runs in background.
    """
    # Safety check
    if is_production(request.application_url, request.env) and not ALLOW_PROD:
        raise HTTPException(
            status_code=403,
            detail="Production environment blocked. Set ALLOW_PROD=true to enable."
        )
    
    discovery_id = str(uuid.uuid4())[:12]
    
    _qa_buddy_v2_discoveries[discovery_id] = {
        "discovery_id": discovery_id,
        "status": "pending",
        "current_stage": "S1",
        "started_at": datetime.utcnow().isoformat() + "Z",
        "application_url": request.application_url
    }
    
    safe_log(f"Starting QA Buddy V2 discovery {discovery_id}", {
        "url": request.application_url,
        "env": request.env
    })
    
    # Start flow in background
    background_tasks.add_task(run_qa_buddy_flow, discovery_id, request, None)
    
    return {
        "discovery_id": discovery_id,
        "status": "running",
        "current_stage": "S1",
        "message": "Discovery started. Use GET /qa-buddy-v2/discover/{id} to check status."
    }


@router.post("/discover/stream")
async def start_discovery_stream(request: QABuddyV2DiscoverRequest):
    """
    Start QA Buddy V2 discovery with SSE streaming for real-time progress.
    """
    # Safety check
    if is_production(request.application_url, request.env) and not ALLOW_PROD:
        raise HTTPException(
            status_code=403,
            detail="Production environment blocked. Set ALLOW_PROD=true to enable."
        )
    
    discovery_id = str(uuid.uuid4())[:12]
    
    _qa_buddy_v2_discoveries[discovery_id] = {
        "discovery_id": discovery_id,
        "status": "pending",
        "current_stage": "S1",
        "started_at": datetime.utcnow().isoformat() + "Z",
        "application_url": request.application_url
    }
    
    async def event_generator():
        """Generator that emits SSE events during discovery."""
        queue = asyncio.Queue()
        
        async def emit_event(event_data: Dict):
            await queue.put(event_data)
        
        # Start discovery in background
        async def run_discovery_task():
            try:
                await run_qa_buddy_flow(discovery_id, request, emit_event=emit_event)
                await queue.put({"event": "COMPLETED", "data": {"discovery_id": discovery_id}})
            except Exception as e:
                await queue.put({"event": "ERROR", "data": {"error": str(e)[:200]}})
            finally:
                await queue.put(None)  # Signal end
        
        # Start background task
        asyncio.create_task(run_discovery_task())
        
        # Stream events
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=60.0)
                if event is None:
                    break
                
                # Format as SSE
                yield f"data: {json.dumps(event)}\n\n"
                
            except asyncio.TimeoutError:
                yield f"data: {json.dumps({'event': 'KEEPALIVE'})}\n\n"
        
        yield "data: [DONE]\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.get("/discover/{discovery_id}")
async def get_discovery(discovery_id: str):
    """
    Get QA Buddy V2 discovery status and results.
    """
    # Check in-memory state
    if discovery_id in _qa_buddy_v2_discoveries:
        return _qa_buddy_v2_discoveries[discovery_id]
    
    # Check file system
    discovery_file = DATA_DIR / discovery_id / "discovery.json"
    if discovery_file.exists():
        with open(discovery_file) as f:
            return json.load(f)
    
    raise HTTPException(status_code=404, detail=f"Discovery {discovery_id} not found")


@router.post("/discover/{discovery_id}/test")
async def execute_test(discovery_id: str, request: QABuddyV2TestRequest, background_tasks: BackgroundTasks):
    """
    S5: Execute test based on prompt.
    
    Requires discovery to be completed (S1-S4 done).
    """
    # Load discovery
    discovery_file = DATA_DIR / discovery_id / "discovery.json"
    if not discovery_file.exists():
        raise HTTPException(status_code=404, detail=f"Discovery {discovery_id} not found")
    
    with open(discovery_file) as f:
        discovery = json.load(f)
    
    if discovery.get("status") != "completed":
        raise HTTPException(
            status_code=400,
            detail=f"Discovery not completed. Current status: {discovery.get('status')}, stage: {discovery.get('current_stage')}"
        )
    
    if not discovery.get("s2_pages") or not discovery.get("s3_access"):
        raise HTTPException(
            status_code=400,
            detail="Discovery incomplete. S2 (pages) and S3 (access) must be completed."
        )
    
    pages = discovery["s2_pages"].get("pages", [])
    access_result = discovery["s3_access"]
    
    discovery_dir = DATA_DIR / discovery_id
    
    # Run test in background
    test_id = str(uuid.uuid4())[:8]
    
    async def run_test():
        try:
            if async_playwright is None:
                raise ImportError("Playwright not installed")
            
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                context = await browser.new_context(
                    viewport={"width": 1920, "height": 1080},
                    ignore_https_errors=True
                )
                page = await context.new_page()
                
                try:
                    # Re-login if needed (use original credentials)
                    original_request = QABuddyV2DiscoverRequest(
                        application_url=discovery.get("application_url", ""),
                        username=None,  # Would need to store securely
                        password=None,
                        env=discovery.get("env", "staging"),
                        config_name="keycloak"
                    )
                    
                    # Execute test prompt
                    test_result = await step5_execute_test_prompt(
                        page,
                        request.test_prompt,
                        pages,
                        access_result,
                        discovery_dir,
                        None
                    )
                    
                    # Save test result
                    test_result["test_id"] = test_id
                    test_result["test_prompt"] = request.test_prompt
                    test_result["completed_at"] = datetime.utcnow().isoformat() + "Z"
                    
                    with open(discovery_dir / f"test_{test_id}.json", "w") as f:
                        json.dump(test_result, f, indent=2)
                    
                finally:
                    await browser.close()
        
        except Exception as e:
            safe_log(f"[{discovery_id}] Test execution error: {e}")
    
    background_tasks.add_task(run_test)
    
    return {
        "test_id": test_id,
        "discovery_id": discovery_id,
        "status": "running",
        "message": "Test execution started. Check discovery results for test output."
    }
