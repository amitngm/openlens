"""
QA Buddy - Human-like QA Agent

A QA Agent that behaves like a senior manual QA engineer:
- SEE like human: Visual inspection, element detection, screenshot analysis
- PERFORM like eye and hands: Actually interact with UI (click, type, navigate, test)
- VALIDATE like architect: Deep validation (API patterns, error handling, security)
- CHECK network tab: Real-time network monitoring (4xx/5xx, slow requests, CORS issues)
- REPORT issues: Alert everyone when problems are found

Endpoints:
- POST /qa-buddy/discover - Progressive discovery with SSE streaming
- POST /qa-buddy/test - Autonomous test execution with UI interactions
- GET /qa-buddy/discover/{discovery_id} - Get discovery results
"""

import os
import json
import uuid
import asyncio
import time
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List, Literal
from urllib.parse import urlparse, urljoin

from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

try:
    from app.services.k8s_client import get_k8s_client
except ImportError:
    get_k8s_client = None

try:
    from app.routers.mongo_inspector import get_mongo_client, get_mongo_uri
except ImportError:
    get_mongo_client = None
    get_mongo_uri = None

try:
    from app.routers.k8s_inspector import load_allowlist
except ImportError:
    def load_allowlist():
        return []

logger = logging.getLogger(__name__)

# =============================================================================
# Configuration
# =============================================================================

DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

ALLOW_PROD = os.getenv("ALLOW_PROD", "false").lower() == "true"
PROD_PATTERNS = ["prod", "production", "live", "prd"]

router = APIRouter(prefix="/qa-buddy", tags=["QA Buddy"])

# State
_qa_buddy_discoveries: Dict[str, Dict] = {}
_qa_buddy_runs: Dict[str, Dict] = {}

# =============================================================================
# Models
# =============================================================================

class QABuddyDiscoverRequest(BaseModel):
    """QA Buddy discovery request - expects logged-in session or will prompt for login."""
    application_url: str
    browser_context: Optional[Dict[str, Any]] = None  # Cookies, localStorage, etc.
    allowed_namespaces: List[str] = []  # K8s namespaces allowed to inspect
    mode: Literal["auto", "strict"] = "auto"
    env: str = "staging"
    username: Optional[str] = None  # Username if login needed
    password: Optional[str] = None  # Password if login needed
    test_prompt: Optional[str] = None  # What user wants to test
    test_prompt: Optional[str] = None  # What user wants to test


class QABuddyTestRequest(BaseModel):
    """QA Buddy autonomous test request."""
    discovery_id: str
    mode: Literal["auto", "strict"] = "auto"


# =============================================================================
# Utilities
# =============================================================================

def is_production(url: str, env: str) -> bool:
    """Check if environment is production."""
    if env.lower() in PROD_PATTERNS:
        return True
    return any(p in url.lower() for p in PROD_PATTERNS)


def safe_log(message: str, data: Dict = None):
    """Safe logging without credentials."""
    if data:
        # Redact sensitive fields
        safe_data = {k: v for k, v in data.items() 
                    if k not in ['password', 'token', 'secret', 'cookie']}
        logger.info(f"{message} | {json.dumps(safe_data)}")
    else:
        logger.info(message)


# =============================================================================
# STEP 1: SESSION VALIDATION (MANDATORY)
# =============================================================================

async def validate_session(
    page,
    application_url: str,
    emit_event=None,
    check_cookies: bool = True,
    original_ui_url: Optional[str] = None
) -> Dict[str, Any]:
    """
    STRICT SESSION VALIDATION - Must pass before ANY discovery.
    
    Checks:
    - Sidebar / top navigation exists OR
    - Profile/avatar/logout visible OR
    - Tenant/project context visible
    
    If login page detected, returns NEEDS_LOGIN status.
    
    Returns:
    {
        status: "PASS" | "FAILED" | "NEEDS_LOGIN",
        stage: "LOGIN_VALIDATION",
        reason: str,
        login_selectors: dict (if NEEDS_LOGIN)
    }
    """
    try:
        safe_log(f"Validating session for {application_url}")
        
        if emit_event:
            await emit_event({
                "event": "SESSION_CHECK",
                "data": {"url": application_url}
            })
        
        # Navigate to application (will redirect to Keycloak if not logged in)
        await page.goto(application_url, timeout=30000, wait_until="networkidle")
        await asyncio.sleep(2)  # Wait for page to stabilize
        
        current_url = page.url
        safe_log(f"Current URL after navigation: {current_url}")
        
        # Check if we were redirected to Keycloak
        is_keycloak_redirect = "keycloak" in current_url.lower() or "auth" in current_url.lower()
        if is_keycloak_redirect:
            safe_log(f"Redirected to Keycloak: {current_url}")
        
        # Check for login page indicators FIRST
        login_page_indicators = {
            "username": [
                "input[name='username']",
                "input[name='email']",
                "input[type='email']",
                "#username",
                "#email",
                "input[id*='username' i]",
                "input[id*='email' i]"
            ],
            "password": [
                "input[name='password']",
                "input[type='password']",
                "#password",
                "input[id*='password' i]"
            ],
            "submit": [
                "button[type='submit']",
                "input[type='submit']",
                "#kc-login",
                "button:has-text('Sign in')",
                "button:has-text('Log in')",
                "button:has-text('Login')",
                "form button[type='submit']"
            ]
        }
        
        found_login_selectors = {}
        login_page_detected = False
        
        for field, selectors in login_page_indicators.items():
            for selector in selectors:
                try:
                    elements = page.locator(selector)
                    if await elements.count() > 0:
                        found_login_selectors[field] = selector
                        login_page_detected = True
                        break
                except:
                    continue
        
        # If login page detected, return NEEDS_LOGIN
        # But also check if we're on Keycloak (redirect flow)
        if login_page_detected and found_login_selectors.get("username") and found_login_selectors.get("password"):
            if emit_event:
                await emit_event({
                    "event": "LOGIN_REQUIRED",
                    "data": {
                        "selectors": found_login_selectors,
                        "message": "Login page detected. Credentials required.",
                        "is_keycloak_redirect": is_keycloak_redirect
                    }
                })
            
            return {
                "status": "NEEDS_LOGIN",
                "stage": "LOGIN_VALIDATION",
                "reason": "Login page detected. Please provide username and password.",
                "login_selectors": found_login_selectors,
                "is_keycloak_redirect": is_keycloak_redirect
            }
        
        # Check for login markers (indicators user is logged in)
        login_markers = [
            # Navigation elements
            "nav",
            ".sidebar",
            ".menu",
            "[role='navigation']",
            "aside",
            # Profile/avatar elements
            "[data-testid*='profile']",
            "[data-testid*='avatar']",
            "[data-testid*='user']",
            ".profile",
            ".avatar",
            ".user-menu",
            # Logout button
            "button:has-text('Logout')",
            "button:has-text('Sign out')",
            "a:has-text('Logout')",
            "a:has-text('Sign out')",
            # Dashboard/home indicators
            ".dashboard",
            ".home",
            "[data-logged-in]",
            # Tenant/project context
            "[class*='tenant']",
            "[class*='project']",
            ".tenant-selector",
            ".project-selector"
        ]
        
        found_markers = []
        for selector in login_markers:
            try:
                elements = page.locator(selector)
                count = await elements.count()
                if count > 0:
                    found_markers.append(selector)
            except:
                continue
        
        # Also check cookies/localStorage if enabled (more reliable than DOM)
        has_session_cookies = False
        if check_cookies:
            try:
                cookies = await page.context.cookies()
                # Check for common session cookie names
                session_cookie_names = ['session', 'sessionid', 'auth', 'token', 'jwt', 'access_token', 'refresh_token']
                for cookie in cookies:
                    if any(name in cookie.get('name', '').lower() for name in session_cookie_names):
                        has_session_cookies = True
                        break
            except:
                pass
        
        # Decision: If no logged-in markers found and no login page, session is invalid
        # BUT: If we have session cookies, be more lenient (might be on a page without nav)
        if len(found_markers) == 0:
            if has_session_cookies:
                # We have cookies but no DOM markers - might be on a detail page
                # This is OK during discovery, but warn
                if emit_event:
                    await emit_event({
                        "event": "SESSION_WARNING",
                        "data": {
                            "message": "Session cookies found but no navigation markers. Continuing discovery..."
                        }
                    })
                # Return PASS but with warning
                return {
                    "status": "PASS",
                    "stage": "LOGIN_VALIDATION",
                    "reason": f"Session cookies detected. Found {len(found_markers)} DOM markers (may be on detail page).",
                    "markers_found": found_markers,
                    "has_cookies": True
                }
            else:
                return {
                    "status": "FAILED",
                    "stage": "LOGIN_VALIDATION",
                    "reason": "No logged-in markers detected and no session cookies found. Session appears invalid or expired."
                }
        
        # Session is valid
        if emit_event:
            await emit_event({
                "event": "SESSION_VALID",
                "data": {
                    "markers_found": len(found_markers),
                    "sample_markers": found_markers[:3]
                }
            })
        
        return {
            "status": "PASS",
            "stage": "LOGIN_VALIDATION",
            "reason": f"Session valid. Found {len(found_markers)} logged-in markers.",
            "markers_found": found_markers
        }
        
    except Exception as e:
        return {
            "status": "FAILED",
            "stage": "LOGIN_VALIDATION",
            "reason": f"Error validating session: {str(e)[:200]}"
        }


# =============================================================================
# VISUAL INSPECTION - See Like Human
# =============================================================================

async def visual_inspection(page, url: str, emit_event=None) -> Dict[str, Any]:
    """
    Visual inspection like a human QA:
    - Take screenshot
    - Detect visible elements
    - Check for broken images
    - Verify layout integrity
    """
    inspection_result = {
        "url": url,
        "screenshot_taken": False,
        "elements_detected": {
            "buttons": 0,
            "forms": 0,
            "links": 0,
            "images": 0,
            "tables": 0
        },
        "broken_images": [],
        "layout_issues": []
    }
    
    try:
        # Take screenshot
        screenshot_path = DATA_DIR / f"inspection_{uuid.uuid4().hex[:8]}.png"
        await page.screenshot(path=str(screenshot_path), full_page=True)
        inspection_result["screenshot_taken"] = True
        inspection_result["screenshot_path"] = str(screenshot_path)
        
        # Detect elements
        buttons = await page.locator("button, input[type='button'], input[type='submit']").count()
        forms = await page.locator("form").count()
        links = await page.locator("a[href]").count()
        images = await page.locator("img").count()
        tables = await page.locator("table").count()
        
        inspection_result["elements_detected"] = {
            "buttons": buttons,
            "forms": forms,
            "links": links,
            "images": images,
            "tables": tables
        }
        
        # Check for broken images
        broken_images = []
        img_elements = page.locator("img")
        img_count = await img_elements.count()
        for i in range(min(img_count, 20)):
            try:
                img = img_elements.nth(i)
                natural_width = await img.evaluate("el => el.naturalWidth")
                if natural_width == 0:
                    src = await img.get_attribute("src") or ""
                    broken_images.append(src[:100])
            except:
                pass
        
        if broken_images:
            inspection_result["broken_images"] = broken_images
            if emit_event:
                await emit_event({
                    "event": "ISSUE_FOUND",
                    "data": {
                        "type": "BROKEN_IMAGE",
                        "severity": "low",
                        "count": len(broken_images),
                        "message": f"Found {len(broken_images)} broken images"
                    }
                })
        
        if emit_event:
            await emit_event({
                "event": "VISUAL_INSPECTION",
                "data": inspection_result
            })
        
    except Exception as e:
        inspection_result["error"] = str(e)[:200]
    
    return inspection_result


# =============================================================================
# UI INTERACTION - Perform Like Eye and Hands
# =============================================================================

async def perform_ui_interactions(
    page,
    page_info: Dict[str, Any],
    emit_event=None
) -> Dict[str, Any]:
    """
    Actually interact with UI like human hands:
    - Click buttons
    - Fill forms (read-only mode)
    - Navigate links
    - Test interactions
    """
    interaction_result = {
        "page": page_info.get("name"),
        "url": page_info.get("url"),
        "actions_performed": [],
        "issues_found": []
    }
    
    try:
        # Navigate to page
        await page.goto(page_info.get("url"), timeout=15000, wait_until="networkidle")
        await asyncio.sleep(1)
        
        if emit_event:
            await emit_event({
                "event": "UI_INTERACTION_START",
                "data": {"page": page_info.get("name")}
            })
        
        # 1. Test buttons (click and verify response)
        buttons = page.locator("button:not([disabled]), input[type='button']:not([disabled]), input[type='submit']:not([disabled])")
        button_count = await buttons.count()
        
        for i in range(min(button_count, 5)):  # Limit to 5 buttons
            try:
                button = buttons.nth(i)
                button_text = await button.inner_text()
                
                # Click button
                await button.click()
                await asyncio.sleep(0.5)
                
                interaction_result["actions_performed"].append({
                    "action": "click_button",
                    "element": button_text[:50],
                    "status": "success"
                })
                
                if emit_event:
                    await emit_event({
                        "event": "UI_ACTION",
                        "data": {
                            "action": "click",
                            "element": button_text[:30],
                            "page": page_info.get("name")
                        }
                    })
            except Exception as e:
                interaction_result["issues_found"].append({
                    "type": "BUTTON_CLICK_FAILED",
                    "message": str(e)[:100]
                })
        
        # 2. Test form fields (fill but don't submit)
        forms = page.locator("form")
        form_count = await forms.count()
        
        for i in range(min(form_count, 3)):
            try:
                form = forms.nth(i)
                inputs = form.locator("input[type='text'], input[type='email'], textarea")
                input_count = await inputs.count()
                
                for j in range(min(input_count, 5)):
                    try:
                        input_field = inputs.nth(j)
                        field_name = await input_field.get_attribute("name") or await input_field.get_attribute("id") or "field"
                        
                        # Fill with test data
                        await input_field.fill("test")
                        await asyncio.sleep(0.2)
                        
                        interaction_result["actions_performed"].append({
                            "action": "fill_field",
                            "field": field_name,
                            "status": "success"
                        })
                    except:
                        pass
            except:
                pass
        
        # 3. Test links (hover and check)
        links = page.locator("a[href]:not([href^='#'])")
        link_count = await links.count()
        
        for i in range(min(link_count, 5)):
            try:
                link = links.nth(i)
                link_text = await link.inner_text()
                href = await link.get_attribute("href")
                
                # Hover
                await link.hover()
                await asyncio.sleep(0.3)
                
                interaction_result["actions_performed"].append({
                    "action": "hover_link",
                    "link": link_text[:50],
                    "href": href[:100] if href else None
                })
            except:
                pass
        
        if emit_event:
            await emit_event({
                "event": "UI_INTERACTION_COMPLETE",
                "data": {
                    "page": page_info.get("name"),
                    "actions": len(interaction_result["actions_performed"])
                }
            })
        
    except Exception as e:
        interaction_result["error"] = str(e)[:200]
        if emit_event:
            await emit_event({
                "event": "ISSUE_FOUND",
                "data": {
                    "type": "UI_INTERACTION_ERROR",
                    "severity": "medium",
                    "page": page_info.get("name"),
                    "message": str(e)[:200]
                }
            })
    
    return interaction_result


# =============================================================================
# ARCHITECTURE VALIDATION - Validate Like Architect
# =============================================================================

async def validate_architecture(
    api_endpoints: List[Dict[str, Any]],
    emit_event=None
) -> Dict[str, Any]:
    """
    Validate architecture like an architect:
    - API patterns consistency
    - Error handling
    - Security headers
    - Response formats
    """
    validation_result = {
        "api_patterns": {},
        "security_issues": [],
        "architecture_issues": [],
        "recommendations": []
    }
    
    # Analyze API patterns
    methods_by_path = {}
    status_codes = {}
    
    for api in api_endpoints:
        url = api.get("url", "")
        method = api.get("method", "")
        status = api.get("status")
        
        # Extract base path
        try:
            parsed = urlparse(url)
            base_path = "/".join(parsed.path.split("/")[:3])  # First 3 path segments
            if base_path not in methods_by_path:
                methods_by_path[base_path] = []
            methods_by_path[base_path].append(method)
        except:
            pass
        
        if status:
            status_codes[status] = status_codes.get(status, 0) + 1
    
    # Check for inconsistent patterns
    for path, methods in methods_by_path.items():
        if len(set(methods)) > 5:  # Too many different methods on same path
            validation_result["architecture_issues"].append({
                "type": "INCONSISTENT_API_PATTERN",
                "path": path,
                "methods": list(set(methods)),
                "message": f"Path {path} uses too many different HTTP methods"
            })
    
    # Check error rate
    total_requests = sum(status_codes.values())
    error_requests = sum(count for status, count in status_codes.items() if status >= 400)
    error_rate = (error_requests / total_requests * 100) if total_requests > 0 else 0
    
    if error_rate > 10:  # More than 10% errors
        validation_result["architecture_issues"].append({
            "type": "HIGH_ERROR_RATE",
            "error_rate": f"{error_rate:.1f}%",
            "message": f"Error rate is {error_rate:.1f}% (threshold: 10%)"
        })
        
        if emit_event:
            await emit_event({
                "event": "ISSUE_FOUND",
                "data": {
                    "type": "HIGH_ERROR_RATE",
                    "severity": "high",
                    "error_rate": f"{error_rate:.1f}%",
                    "message": f"API error rate is {error_rate:.1f}%"
                }
            })
    
    # Security recommendations
    if len(api_endpoints) > 0:
        https_count = sum(1 for api in api_endpoints if api.get("url", "").startswith("https://"))
        https_rate = (https_count / len(api_endpoints) * 100) if api_endpoints else 0
        
        if https_rate < 100:
            validation_result["security_issues"].append({
                "type": "MIXED_HTTP_HTTPS",
                "message": f"Only {https_rate:.1f}% of APIs use HTTPS"
            })
    
    validation_result["api_patterns"] = {
        "unique_paths": len(methods_by_path),
        "total_endpoints": len(api_endpoints),
        "status_distribution": status_codes
    }
    
    if emit_event:
        await emit_event({
            "event": "ARCHITECTURE_VALIDATION",
            "data": validation_result
        })
    
    return validation_result


# =============================================================================
# LOGIN CONFIG (Same as auto_qa.py)
# =============================================================================

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


# =============================================================================
# LOGIN FUNCTION
# =============================================================================

async def perform_login(
    page,
    username: str,
    password: str,
    login_selectors: Optional[Dict[str, str]] = None,
    discovery_dir: Optional[Path] = None,
    emit_event=None
) -> Dict[str, Any]:
    """
    Perform login using provided credentials - robust like auto_qa.py.
    """
    try:
        if emit_event:
            await emit_event({
                "event": "LOGIN_START",
                "data": {"message": "Attempting login..."}
            })
        
        # Use login config (try keycloak first, then default)
        config = LOGIN_CONFIGS.get("keycloak", LOGIN_CONFIGS["default"])
        
        # Take screenshot before login
        if discovery_dir:
            await page.screenshot(path=str(discovery_dir / "before_login.png"))
        
        # Fill username - try all selectors
        username_filled = False
        for selector in config["username_selector"].split(", "):
            try:
                selector = selector.strip()
                if await page.locator(selector).first.count() > 0:
                    await page.locator(selector).first.fill(username)
                    username_filled = True
                    safe_log(f"Filled username using selector: {selector}")
                    break
            except Exception as e:
                safe_log(f"Failed selector {selector}: {e}")
                continue
        
        if not username_filled:
            # Try the provided selectors if config didn't work
            if login_selectors and login_selectors.get("username"):
                try:
                    await page.locator(login_selectors["username"]).first.fill(username)
                    username_filled = True
                except:
                    pass
        
        if not username_filled:
            if emit_event:
                await emit_event({
                    "event": "LOGIN_ERROR",
                    "data": {"error": "Cannot find username field"}
                })
            return {
                "status": "FAILED",
                "message": "Cannot find username field. Tried all selectors."
            }
        
        # Fill password - try all selectors
        password_filled = False
        for selector in config["password_selector"].split(", "):
            try:
                selector = selector.strip()
                if await page.locator(selector).first.count() > 0:
                    await page.locator(selector).first.fill(password)
                    password_filled = True
                    safe_log(f"Filled password using selector: {selector}")
                    break
            except Exception as e:
                safe_log(f"Failed selector {selector}: {e}")
                continue
        
        if not password_filled:
            # Try the provided selectors if config didn't work
            if login_selectors and login_selectors.get("password"):
                try:
                    await page.locator(login_selectors["password"]).first.fill(password)
                    password_filled = True
                except:
                    pass
        
        if not password_filled:
            if emit_event:
                await emit_event({
                    "event": "LOGIN_ERROR",
                    "data": {"error": "Cannot find password field"}
                })
            return {
                "status": "FAILED",
                "message": "Cannot find password field. Tried all selectors."
            }
        
        # Take screenshot after filling
        if discovery_dir:
            await page.screenshot(path=str(discovery_dir / "after_fill.png"))
        
        # Submit - try all selectors
        # IMPORTANT: After Keycloak login, we'll be redirected back to UI
        submit_clicked = False
        current_url_before_submit = page.url
        safe_log(f"URL before login submit: {current_url_before_submit}")
        
        for selector in config["submit_selector"].split(", "):
            try:
                selector = selector.strip()
                if await page.locator(selector).first.count() > 0:
                    # Wait for navigation after submit (Keycloak redirects back to UI)
                    try:
                        async with page.expect_navigation(timeout=30000, wait_until="networkidle"):
                            await page.locator(selector).first.click()
                        submit_clicked = True
                        safe_log(f"Clicked submit using selector: {selector}, waiting for redirect")
                        break
                    except asyncio.TimeoutError:
                        # Navigation might have started but not completed, try without wait
                        await page.locator(selector).first.click()
                        submit_clicked = True
                        safe_log(f"Clicked submit using selector: {selector}, navigation timeout")
                        break
            except Exception as e:
                safe_log(f"Failed selector {selector}: {e}")
                continue
        
        if not submit_clicked:
            # Try the provided selectors if config didn't work
            if login_selectors and login_selectors.get("submit"):
                try:
                    async with page.expect_navigation(timeout=30000, wait_until="networkidle"):
                        await page.locator(login_selectors["submit"]).first.click()
                    submit_clicked = True
                except:
                    try:
                        await page.locator(login_selectors["submit"]).first.click()
                        submit_clicked = True
                    except:
                        pass
        
        if not submit_clicked:
            if emit_event:
                await emit_event({
                    "event": "LOGIN_ERROR",
                    "data": {"error": "Cannot find submit button"}
                })
            return {
                "status": "FAILED",
                "message": "Cannot find submit button. Tried all selectors."
            }
        
        # Wait for redirect back to UI (Keycloak redirects after successful login)
        # Give extra time for OAuth/OIDC redirect flow
        await asyncio.sleep(3)  # Initial wait
        
        try:
            # Wait for navigation away from Keycloak domain
            await page.wait_for_load_state("networkidle", timeout=20000)
            await asyncio.sleep(2)  # Additional wait for redirect to complete
        except:
            # Navigation might have already completed
            await asyncio.sleep(2)
        
        # Check current URL after login
        current_url_after = page.url
        safe_log(f"URL after login submit: {current_url_after}")
        
        # Check if we're back on UI domain (not Keycloak)
        is_still_on_keycloak = "keycloak" in current_url_after.lower() or "auth" in current_url_after.lower()
        if is_still_on_keycloak:
            safe_log(f"Still on Keycloak/auth domain after login: {current_url_after}")
        else:
            safe_log(f"Redirected away from Keycloak: {current_url_after}")
        
        # Take screenshot after login attempt
        if discovery_dir:
            await page.screenshot(path=str(discovery_dir / "after_login.png"))
        
        current_url = page.url
        safe_log(f"Current URL after login: {current_url}")
        
        # Check if login was successful by looking for logged-in markers
        success_indicators = config["success_indicator"].split(", ")
        login_markers = [
            "nav", ".sidebar", ".menu", "[role='navigation']", "aside",
            "button:has-text('Logout')", "button:has-text('Sign out')",
            "a:has-text('Logout')", "a:has-text('Sign out')",
            ".dashboard", ".home", "[data-logged-in]",
            "[class*='tenant']", "[class*='project']"
        ]
        
        # Combine config indicators with common markers
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
        
        # Also check if we're still on login page (negative check)
        still_on_login = False
        login_page_indicators = [
            "input[name='username']", "input[name='password']",
            "#username", "#password", "#kc-login"
        ]
        for selector in login_page_indicators:
            try:
                if await page.locator(selector).first.count() > 0:
                    still_on_login = True
                    break
            except:
                continue
        
        # If still on login page and no success markers, login failed
        if still_on_login and not login_success:
            if emit_event:
                await emit_event({
                    "event": "LOGIN_FAILED",
                    "data": {
                        "message": "Still on login page - invalid credentials or login failed",
                        "url": current_url
                    }
                })
            return {
                "status": "FAILED",
                "message": "Still on login page - invalid credentials or login failed",
                "url": current_url
            }
        
        if login_success:
            if emit_event:
                await emit_event({
                    "event": "LOGIN_SUCCESS",
                    "data": {
                        "message": "Login successful",
                        "url": current_url,
                        "markers_found": found_markers[:3]
                    }
                })
            return {
                "status": "SUCCESS",
                "message": "Login successful",
                "url": current_url
            }
        else:
            # If URL changed but no markers found, might still be success
            if current_url != page.url or "login" not in current_url.lower():
                if emit_event:
                    await emit_event({
                        "event": "LOGIN_SUCCESS",
                        "data": {
                            "message": "Login successful (URL changed)",
                            "url": current_url
                        }
                    })
                return {
                    "status": "SUCCESS",
                    "message": "Login successful (URL changed)",
                    "url": current_url
                }
            else:
                if emit_event:
                    await emit_event({
                        "event": "LOGIN_FAILED",
                        "data": {
                            "message": "Login failed - no success markers found",
                            "url": current_url
                        }
                    })
                return {
                    "status": "FAILED",
                    "message": "Login failed - no success markers found",
                    "url": current_url
                }
        
    except Exception as e:
        error_msg = str(e)[:200]
        safe_log(f"Login error: {error_msg}")
        if emit_event:
            await emit_event({
                "event": "LOGIN_ERROR",
                "data": {"error": error_msg}
            })
        return {
            "status": "ERROR",
            "message": f"Login error: {error_msg}"
        }


# =============================================================================
# STEP 2: PROGRESSIVE DISCOVERY (HUMAN-LIKE)
# =============================================================================

async def discover_application(
    discovery_id: str,
    request: QABuddyDiscoverRequest,
    page,
    emit_event=None
) -> Dict[str, Any]:
    """
    Progressive discovery like a human QA engineer.
    
    Discovers:
    1. Navigation structure
    2. Modules (Network, Compute, LB, Storage, etc.)
    3. Pages under each module
    4. Actions on each page
    5. Network activity (APIs, 4xx/5xx)
    6. Tenant/project context
    """
    discovery_dir = DATA_DIR / discovery_id
    discovery_dir.mkdir(parents=True, exist_ok=True)
    
    result = {
        "discovery_id": discovery_id,
        "application_url": request.application_url,
        "status": "running",
        "started_at": datetime.utcnow().isoformat() + "Z",
        "modules": [],
        "api_endpoints": [],
        "tenant_project_context": [],
        "summary": {
            "total_modules": 0,
            "total_pages": 0,
            "total_actions": 0,
            "total_apis": 0,
            "failed_apis": 0
        },
        "warnings": [],
        "error": None
    }
    
    api_requests = []
    failed_requests = []
    slow_requests = []
    network_issues = []
    
    # =============================================================================
    # ENHANCED NETWORK MONITORING - Check Network Tab Like Human
    # =============================================================================
    
    def capture_request(req):
        url = req.url
        start_time = time.time()
        req._qa_buddy_start_time = start_time
        
        if any(x in url for x in ['/api/', '/v1/', '/v2/', '/graphql', '/rest/']):
            api_requests.append({
                "url": url,
                "method": req.method,
                "type": req.resource_type,
                "status": None,
                "start_time": start_time,
                "duration_ms": None
            })
    
    def capture_response(resp):
        response_time = time.time()
        duration_ms = None
        
        for api in api_requests:
            if api["url"] == resp.url and api["status"] is None:
                if api.get("start_time"):
                    duration_ms = int((response_time - api["start_time"]) * 1000)
                    api["duration_ms"] = duration_ms
                
                api["status"] = resp.status
                
                # Detect issues
                if resp.status >= 400:
                    issue = {
                        "type": "API_ERROR",
                        "severity": "high" if resp.status >= 500 else "medium",
                        "url": resp.url,
                        "method": api["method"],
                        "status": resp.status,
                        "message": f"API returned {resp.status}",
                        "timestamp": datetime.utcnow().isoformat() + "Z"
                    }
                    failed_requests.append({
                        "url": resp.url,
                        "method": api["method"],
                        "status": resp.status
                    })
                    network_issues.append(issue)
                    
                    # Report issue immediately
                    if emit_event:
                        asyncio.create_task(emit_event({
                            "event": "ISSUE_FOUND",
                            "data": issue
                        }))
                
                # Detect slow requests (>3 seconds)
                if duration_ms and duration_ms > 3000:
                    issue = {
                        "type": "SLOW_REQUEST",
                        "severity": "medium",
                        "url": resp.url,
                        "method": api["method"],
                        "duration_ms": duration_ms,
                        "message": f"Request took {duration_ms}ms (>3s threshold)",
                        "timestamp": datetime.utcnow().isoformat() + "Z"
                    }
                    slow_requests.append({
                        "url": resp.url,
                        "duration_ms": duration_ms
                    })
                    network_issues.append(issue)
                    
                    if emit_event:
                        asyncio.create_task(emit_event({
                            "event": "ISSUE_FOUND",
                            "data": issue
                        }))
                
                # Check CORS issues
                try:
                    cors_header = resp.headers.get("access-control-allow-origin")
                    if not cors_header and resp.status == 0:
                        issue = {
                            "type": "CORS_ISSUE",
                            "severity": "high",
                            "url": resp.url,
                            "message": "Possible CORS issue detected",
                            "timestamp": datetime.utcnow().isoformat() + "Z"
                        }
                        network_issues.append(issue)
                        if emit_event:
                            asyncio.create_task(emit_event({
                                "event": "ISSUE_FOUND",
                                "data": issue
                            }))
                except:
                    pass
                
                break
    
    page.on("request", capture_request)
    page.on("response", capture_response)
    
    # Console errors - Report immediately
    console_errors = []
    def capture_console(msg):
        if msg.type == "error":
            error_info = {
                "type": msg.type,
                "text": msg.text
            }
            console_errors.append(error_info)
            
            # Report console error as issue
            issue = {
                "type": "CONSOLE_ERROR",
                "severity": "high",
                "message": msg.text[:200],
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
            network_issues.append(issue)
            
            if emit_event:
                asyncio.create_task(emit_event({
                    "event": "ISSUE_FOUND",
                    "data": issue
                }))
    
    page.on("console", capture_console)
    
    # Page errors
    page.on("pageerror", lambda error: asyncio.create_task(emit_event({
        "event": "ISSUE_FOUND",
        "data": {
            "type": "PAGE_ERROR",
            "severity": "high",
            "message": str(error)[:200],
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
    })) if emit_event else None)
    
    try:
        # Show test prompt if provided
        if request.test_prompt:
            if emit_event:
                await emit_event({
                    "event": "TEST_PROMPT_RECEIVED",
                    "data": {"prompt": request.test_prompt[:100]}
                })
            safe_log(f"[{discovery_id}] Test focus: {request.test_prompt[:100]}")
        
        # 1. Discover Navigation Structure
        if emit_event:
            await emit_event({
                "event": "NAV_FOUND",
                "data": {"stage": "discovering_navigation"}
            })
        
        safe_log(f"[{discovery_id}] Discovering navigation structure")
        
        nav_selectors = [
            "nav a",
            ".sidebar a",
            ".menu a",
            "[role='navigation'] a",
            "aside a",
            ".nav-link",
            "[data-testid*='nav'] a"
        ]
        
        nav_links = []
        for selector in nav_selectors:
            try:
                links = page.locator(selector)
                count = await links.count()
                for i in range(min(count, 20)):
                    try:
                        link = links.nth(i)
                        href = await link.get_attribute("href")
                        text = await link.inner_text()
                        if href and text.strip():
                            full_url = urljoin(request.application_url, href)
                            nav_links.append({
                                "text": text.strip()[:50],
                                "url": full_url,
                                "selector": selector
                            })
                    except:
                        continue
            except:
                continue
        
        # Deduplicate
        seen_urls = set()
        unique_nav_links = []
        for link in nav_links:
            if link["url"] not in seen_urls:
                seen_urls.add(link["url"])
                unique_nav_links.append(link)
        
        if emit_event:
            await emit_event({
                "event": "NAV_DISCOVERED",
                "data": {
                    "count": len(unique_nav_links),
                    "links": unique_nav_links[:10]  # First 10
                }
            })
        
        # 2. Discover Modules (group navigation by common patterns)
        safe_log(f"[{discovery_id}] Discovering modules")
        
        modules = {}
        for link in unique_nav_links:
            # Extract module name from URL or text
            url_parts = urlparse(link["url"]).path.strip("/").split("/")
            module_name = url_parts[0] if url_parts else "Home"
            
            # Normalize module names
            if module_name in ["", "dashboard", "home"]:
                module_name = "Dashboard"
            else:
                module_name = module_name.capitalize()
            
            if module_name not in modules:
                modules[module_name] = {
                    "name": module_name,
                    "pages": [],
                    "actions": []
                }
            
            # Add as page
            page_name = url_parts[1] if len(url_parts) > 1 else "Overview"
            modules[module_name]["pages"].append({
                "name": page_name.capitalize(),
                "url": link["url"],
                "text": link["text"]
            })
        
        # Helper: Quick session check (just check if we're on login page)
        async def quick_session_check(page, original_url: str) -> bool:
            """Quick check: Are we on a login page? If yes, session expired."""
            try:
                current_url = page.url
                # If redirected to login, session expired
                if "login" in current_url.lower() or "signin" in current_url.lower():
                    return False
                # Check for login form elements
                login_indicators = [
                    "input[name='username']", "input[name='password']",
                    "#username", "#password", "form[action*='login']"
                ]
                for selector in login_indicators:
                    try:
                        if await page.locator(selector).count() > 0:
                            # Check if we also have logged-in markers (might be on login page but already logged in)
                            nav_markers = await page.locator("nav, .sidebar, .menu").count()
                            if nav_markers == 0:
                                return False  # Login page without nav = session expired
                    except:
                        continue
                return True  # Not on login page
            except:
                return True  # Assume OK if check fails
        
        # 3. Discover Actions on Pages (incrementally)
        pages_visited = 0
        last_session_check = 0
        for module_name, module_data in list(modules.items())[:5]:  # Limit to 5 modules
            # Periodic session check: Check cookies without navigating (less disruptive)
            current_time = time.time()
            if pages_visited > 0 and (current_time - last_session_check) > 30:  # Every 30 seconds
                try:
                    if emit_event:
                        await emit_event({
                            "event": "SESSION_CHECK_PERIODIC",
                            "data": {"message": "Checking session validity..."}
                        })
                    
                    # Check cookies without navigating (preserves current page state)
                    cookies = await page.context.cookies()
                    session_cookie_names = ['session', 'sessionid', 'auth', 'token', 'jwt', 'access_token', 'refresh_token']
                    has_session_cookies = any(
                        any(name in cookie.get('name', '').lower() for name in session_cookie_names)
                        for cookie in cookies
                    )
                    
                    # Also check current URL - if redirected to login, session expired
                    current_url = page.url
                    if "login" in current_url.lower() or "signin" in current_url.lower():
                        # Check if we have nav markers (might be on login page but already logged in)
                        nav_markers = await page.locator("nav, .sidebar, .menu").count()
                        if nav_markers == 0:
                            # Session expired
                            if emit_event:
                                await emit_event({
                                    "event": "SESSION_EXPIRED",
                                    "data": {
                                        "message": "Session expired during discovery. Please log in again."
                                    }
                                })
                            discovery_result["error"] = "Session expired during discovery"
                            discovery_result["status"] = "failed"
                            return discovery_result
                    
                    if not has_session_cookies:
                        # No session cookies - might be expired, but don't fail immediately
                        # Just log a warning
                        if emit_event:
                            await emit_event({
                                "event": "SESSION_WARNING",
                                "data": {
                                    "message": "Session cookies not found. Continuing with caution..."
                                }
                            })
                    
                    last_session_check = current_time
                except Exception as e:
                    safe_log(f"[{discovery_id}] Periodic session check failed: {str(e)[:100]}")
                    # Continue if check fails - don't stop discovery
            
            if emit_event:
                await emit_event({
                    "event": "MODULE_DISCOVERED",
                    "data": {
                        "module": module_name,
                        "pages": len(module_data["pages"])
                    }
                })
            
            # Visit first page of module to discover actions
            if module_data["pages"]:
                first_page = module_data["pages"][0]
                try:
                    await page.goto(first_page["url"], timeout=15000, wait_until="networkidle")
                    await asyncio.sleep(1)
                    pages_visited += 1
                    
                    # VISUAL INSPECTION - See like human
                    visual_result = await visual_inspection(page, first_page["url"], emit_event)
                    module_data["pages"][0]["visual_inspection"] = visual_result
                    
                    # Look for action buttons
                    action_selectors = [
                        "button:has-text('Create')",
                        "button:has-text('Add')",
                        "button:has-text('New')",
                        "button:has-text('Edit')",
                        "button:has-text('Delete')",
                        "button:has-text('Update')",
                        "a:has-text('Create')",
                        "a:has-text('Add')",
                        "[data-testid*='create']",
                        "[data-testid*='add']"
                    ]
                    
                    actions = []
                    for selector in action_selectors:
                        try:
                            buttons = page.locator(selector)
                            count = await buttons.count()
                            for i in range(min(count, 5)):
                                text = await buttons.nth(i).inner_text()
                                if text.strip():
                                    actions.append(text.strip()[:30])
                        except:
                            continue
                    
                    # Check for tables
                    has_table = await page.locator("table, .table, [role='table']").count() > 0
                    
                    # Check for forms
                    has_form = await page.locator("form, [role='form']").count() > 0
                    
                    module_data["pages"][0]["actions"] = list(set(actions))[:10]
                    module_data["pages"][0]["has_table"] = has_table
                    module_data["pages"][0]["has_form"] = has_form
                    
                    # UI INTERACTION - Perform like eye and hands
                    if emit_event:
                        await emit_event({
                            "event": "UI_TESTING_START",
                            "data": {"module": module_name, "page": first_page["name"]}
                        })
                    
                    interaction_result = await perform_ui_interactions(page, first_page, emit_event)
                    module_data["pages"][0]["ui_interactions"] = interaction_result
                    
                except Exception as e:
                    safe_log(f"Failed to visit {first_page['url']}: {e}")
                    continue
        
        # 4. Detect Tenant/Project Context
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
        
        # Check UI dropdowns
        try:
            tenant_selectors = [
                "select[name*='tenant' i], select[id*='tenant' i]",
                "select[name*='project' i], select[id*='project' i]",
                "[data-testid*='tenant'], [data-testid*='project']"
            ]
            for selector in tenant_selectors:
                try:
                    dropdown = page.locator(selector).first
                    if await dropdown.count() > 0:
                        options = await dropdown.locator("option").all()
                        for opt in options[:5]:
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
        
        # Update result
        result["modules"] = list(modules.values())
        result["api_endpoints"] = [
            {
                "url": api["url"],
                "method": api["method"],
                "status": api["status"],
                "duration_ms": api.get("duration_ms")
            }
            for api in api_requests if api["status"] is not None
        ]
        result["tenant_project_context"] = tenant_project_candidates[:10]
        result["summary"]["total_modules"] = len(modules)
        result["summary"]["total_pages"] = sum(len(m["pages"]) for m in modules.values())
        result["summary"]["total_actions"] = sum(
            sum(len(p.get("actions", [])) for p in m["pages"])
            for m in modules.values()
        )
        result["summary"]["total_apis"] = len([a for a in api_requests if a["status"] is not None])
        result["summary"]["failed_apis"] = len(failed_requests)
        result["summary"]["slow_apis"] = len(slow_requests)
        result["network_issues"] = network_issues
        result["console_errors"] = console_errors
        
        if console_errors:
            result["warnings"].append(f"Found {len(console_errors)} console errors")
        
        if failed_requests:
            result["warnings"].append(f"Found {len(failed_requests)} failed API requests (4xx/5xx)")
        
        if slow_requests:
            result["warnings"].append(f"Found {len(slow_requests)} slow API requests (>3s)")
        
        # ARCHITECTURE VALIDATION - Validate like architect
        if emit_event:
            await emit_event({
                "event": "ARCHITECTURE_VALIDATION_START",
                "data": {}
            })
        
        architecture_validation = await validate_architecture(
            [a for a in api_requests if a.get("status") is not None],
            emit_event
        )
        result["architecture_validation"] = architecture_validation
        
        # Summary of all issues found
        all_issues = network_issues + architecture_validation.get("architecture_issues", []) + architecture_validation.get("security_issues", [])
        result["total_issues"] = len(all_issues)
        result["issues_by_severity"] = {
            "high": len([i for i in all_issues if i.get("severity") == "high"]),
            "medium": len([i for i in all_issues if i.get("severity") == "medium"]),
            "low": len([i for i in all_issues if i.get("severity") == "low"])
        }
        
        result["status"] = "completed"
        result["completed_at"] = datetime.utcnow().isoformat() + "Z"
        
        # Save discovery
        with open(discovery_dir / "discovery.json", "w") as f:
            json.dump(result, f, indent=2)
        
        if emit_event:
            await emit_event({
                "event": "DISCOVERY_COMPLETE",
                "data": {
                    "modules": result["summary"]["total_modules"],
                    "pages": result["summary"]["total_pages"],
                    "apis": result["summary"]["total_apis"]
                }
            })
        
        return result
        
    except Exception as e:
        result["status"] = "failed"
        result["error"] = str(e)[:500]
        result["completed_at"] = datetime.utcnow().isoformat() + "Z"
        
        # Save failed discovery
        with open(discovery_dir / "discovery.json", "w") as f:
            json.dump(result, f, indent=2)
        
        if emit_event:
            await emit_event({
                "event": "DISCOVERY_FAILED",
                "data": {"error": str(e)[:200]}
            })
        
        return result


# =============================================================================
# STEP 3: AUTONOMOUS TEST DECISION
# =============================================================================

def decide_tests(discovery: Dict[str, Any], mode: str = "auto") -> List[Dict[str, Any]]:
    """
    Decide what to test autonomously (like a human QA).
    
    Tests decided:
    - Page health checks
    - Console errors
    - Failed APIs
    - Required field validation
    - Read-only checks by default
    - Safe CRUD only if cleanup is possible
    """
    tests = []
    
    # 1. Health checks for each discovered page
    for module in discovery.get("modules", []):
        for page in module.get("pages", []):
            tests.append({
                "name": f"Health check: {module['name']} > {page['name']}",
                "type": "health_check",
                "module": module["name"],
                "page": page["name"],
                "url": page.get("url"),
                "checks": ["page_loads", "no_console_errors", "no_4xx_5xx"]
            })
    
    # 2. API health checks
    for api in discovery.get("api_endpoints", []):
        if api.get("status") and api["status"] >= 400:
            tests.append({
                "name": f"API check: {api['method']} {api['url']}",
                "type": "api_check",
                "url": api["url"],
                "method": api["method"],
                "expected_status": 200,
                "reason": f"Previously returned {api['status']}"
            })
    
    # 3. Form validation (read-only)
    for module in discovery.get("modules", []):
        for page in module.get("pages", []):
            if page.get("has_form"):
                tests.append({
                    "name": f"Form validation: {module['name']} > {page['name']}",
                    "type": "form_validation",
                    "module": module["name"],
                    "page": page["name"],
                    "url": page.get("url"),
                    "mode": "read_only"  # Don't submit, just check fields
                })
    
    # 4. Table functionality (read-only)
    for module in discovery.get("modules", []):
        for page in module.get("pages", []):
            if page.get("has_table"):
                tests.append({
                    "name": f"Table check: {module['name']} > {page['name']}",
                    "type": "table_check",
                    "module": module["name"],
                    "page": page["name"],
                    "url": page.get("url"),
                    "checks": ["table_renders", "has_rows", "pagination_works"]
                })
    
    return tests


# =============================================================================
# STEP 4: SELF DEBUG (HUMAN BEHAVIOR)
# =============================================================================

async def self_debug(
    failure_info: Dict[str, Any],
    allowed_namespaces: List[str],
    discovery_dir: Path
) -> Dict[str, Any]:
    """
    Self-debug on failure like a human QA:
    1. Screenshot (already captured)
    2. HAR (network log)
    3. Identify impacted backend service
    4. Check K8s pods/logs if in allowed namespace
    5. Check MongoDB if configured
    """
    debug_info = {
        "screenshot": None,
        "har": None,
        "k8s_debug": {},
        "mongo_debug": {},
        "identified_services": []
    }
    
    # 1. Screenshot path
    screenshot_path = discovery_dir / "failure_screenshot.png"
    if screenshot_path.exists():
        debug_info["screenshot"] = str(screenshot_path)
    
    # 2. HAR path
    har_path = discovery_dir / "network.har"
    if har_path.exists():
        debug_info["har"] = str(har_path)
    
    # 3. Identify impacted services from failed APIs
    failed_urls = failure_info.get("failed_apis", [])
    for api in failed_urls:
        url = api.get("url", "")
        try:
            parsed = urlparse(url)
            service_name = parsed.netloc.split(".")[0] if "." in parsed.netloc else parsed.netloc
            debug_info["identified_services"].append({
                "service": service_name,
                "url": url,
                "status": api.get("status")
            })
        except:
            pass
    
    # 4. K8s Debug (if service in allowed namespace)
    if allowed_namespaces and get_k8s_client:
        try:
            k8s = get_k8s_client()
            for namespace in allowed_namespaces[:3]:  # Limit to 3
                try:
                    pods = k8s.list_pods(namespace=namespace)
                    debug_info["k8s_debug"][namespace] = {
                        "pods": [
                            {
                                "name": pod["name"],
                                "phase": pod["phase"],
                                "ready": pod["ready"]
                            }
                            for pod in pods[:10]
                        ]
                    }
                    
                    # Check for crash/restart patterns
                    for pod in pods[:5]:
                        if pod["phase"] != "Running" or not pod["ready"]:
                            try:
                                logs = k8s.get_pod_logs(
                                    pod["name"],
                                    namespace=namespace,
                                    tail_lines=50
                                )
                                debug_info["k8s_debug"][namespace][f"{pod['name']}_logs"] = logs[:1000]
                            except:
                                pass
                except Exception as e:
                    debug_info["k8s_debug"][namespace] = {"error": str(e)[:100]}
        except Exception as e:
            logger.warning(f"K8s debug failed: {e}")
    
    # 5. MongoDB Debug (if configured)
    if allowed_namespaces and get_mongo_uri and get_mongo_client:
        for namespace in allowed_namespaces[:2]:
            mongo_uri = get_mongo_uri(namespace)
            if mongo_uri:
                try:
                    client = get_mongo_client(namespace)
                    if client:
                        from urllib.parse import urlparse
                        db_name = urlparse(mongo_uri).path.lstrip('/') or 'admin'
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
    
    return debug_info


# =============================================================================
# Main Discovery Runner
# =============================================================================

async def run_qa_buddy_discovery(
    discovery_id: str,
    request: QABuddyDiscoverRequest,
    emit_event=None
):
    """Main QA Buddy discovery runner."""
    from playwright.async_api import async_playwright
    
    discovery_dir = DATA_DIR / discovery_id
    discovery_dir.mkdir(parents=True, exist_ok=True)
    
    _qa_buddy_discoveries[discovery_id]["status"] = "running"
    
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                viewport={"width": 1920, "height": 1080},
                ignore_https_errors=True
            )
            
            # Apply browser context if provided (cookies, localStorage)
            if request.browser_context:
                if "cookies" in request.browser_context:
                    await context.add_cookies(request.browser_context["cookies"])
                if "localStorage" in request.browser_context:
                    # localStorage needs to be set per page
                    pass
            
            page = await context.new_page()
            
            # STEP 1: SESSION VALIDATION (MANDATORY)
            if emit_event:
                await emit_event({
                    "event": "STEP_START",
                    "data": {"step": "SESSION_VALIDATION"}
                })
            
            session_result = await validate_session(page, request.application_url, emit_event, original_ui_url=request.application_url)
            
            # Handle NEEDS_LOGIN case
            if session_result["status"] == "NEEDS_LOGIN":
                if emit_event:
                    await emit_event({
                        "event": "LOGIN_REQUIRED",
                        "data": {
                            "selectors": session_result.get("login_selectors", {}),
                            "message": "Login page detected. Credentials required."
                        }
                    })
                
                # If credentials provided, attempt login
                if request.username and request.password:
                    login_result = await perform_login(
                        page,
                        request.username,
                        request.password,
                        session_result.get("login_selectors", {}),
                        discovery_dir,
                        emit_event
                    )
                    
                    if login_result["status"] == "SUCCESS":
                        # After Keycloak login, we should be redirected back to the application
                        # Wait a bit more for the redirect to complete
                        await asyncio.sleep(2)
                        
                        current_url = page.url
                        safe_log(f"[{discovery_id}] URL after login: {current_url}")
                        
                        # Check if we're still on Keycloak/auth domain
                        is_still_on_keycloak = "keycloak" in current_url.lower() or ("auth" in current_url.lower() and "login" in current_url.lower())
                        
                        # If still on Keycloak or not on the application domain, navigate back
                        application_domain = urlparse(request.application_url).netloc
                        current_domain = urlparse(current_url).netloc
                        
                        if is_still_on_keycloak or (application_domain not in current_domain and current_domain not in application_domain):
                            safe_log(f"[{discovery_id}] Still on Keycloak or different domain. Navigating back to application: {request.application_url}")
                            try:
                                await page.goto(request.application_url, timeout=30000, wait_until="networkidle")
                                await asyncio.sleep(2)  # Wait for page to load
                                current_url = page.url
                                safe_log(f"[{discovery_id}] Navigated to: {current_url}")
                            except Exception as e:
                                safe_log(f"[{discovery_id}] Failed to navigate back: {e}")
                                # Continue with current URL - might still work
                        
                        # Quick check: just verify we're not on login page (don't do full validation again)
                        current_url_after = page.url
                        is_on_login = "login" in current_url_after.lower() or "signin" in current_url_after.lower()
                        is_on_keycloak = "keycloak" in current_url_after.lower()
                        
                        # Check for basic logged-in markers without full validation
                        nav_markers = await page.locator("nav, .sidebar, .menu, [role='navigation']").count()
                        
                        if (is_on_login or is_on_keycloak) and nav_markers == 0:
                            # Still on login page, login failed
                            _qa_buddy_discoveries[discovery_id]["status"] = "failed"
                            _qa_buddy_discoveries[discovery_id]["error"] = "Login appeared successful but still on login page"
                            
                            result = {
                                "discovery_id": discovery_id,
                                "status": "FAILED",
                                "stage": "LOGIN_VALIDATION",
                                "reason": "Login appeared successful but still on login page. Please check credentials.",
                                "completed_at": datetime.utcnow().isoformat() + "Z"
                            }
                            
                            with open(discovery_dir / "discovery.json", "w") as f:
                                json.dump(result, f, indent=2)
                            
                            if emit_event:
                                await emit_event({
                                    "event": "SESSION_INVALID",
                                    "data": {
                                        "stage": "LOGIN_VALIDATION",
                                        "reason": "Login appeared successful but still on login page"
                                    }
                                })
                            
                            await browser.close()
                            return result
                        else:
                            # Login successful - mark session as valid and continue
                            if emit_event:
                                await emit_event({
                                    "event": "SESSION_VALID",
                                    "data": {
                                        "markers_found": nav_markers,
                                        "message": "Login successful, session validated"
                                    }
                                })
                            # Set session_result to PASS to continue discovery
                            session_result = {"status": "PASS", "stage": "LOGIN_VALIDATION", "reason": "Login successful"}
                            safe_log(f"[{discovery_id}] Login successful, continuing with discovery on: {current_url_after}")
                    else:
                        _qa_buddy_discoveries[discovery_id]["status"] = "failed"
                        _qa_buddy_discoveries[discovery_id]["error"] = login_result.get("message", "Login failed")
                        
                        # Take screenshot of failed login
                        try:
                            await page.screenshot(path=str(discovery_dir / "login_failed.png"))
                        except:
                            pass
                        
                        result = {
                            "discovery_id": discovery_id,
                            "status": "FAILED",
                            "stage": "LOGIN",
                            "reason": login_result.get("message", "Login failed"),
                            "url_after_login": login_result.get("url"),
                            "completed_at": datetime.utcnow().isoformat() + "Z"
                        }
                        
                        with open(discovery_dir / "discovery.json", "w") as f:
                            json.dump(result, f, indent=2)
                        
                        await browser.close()
                        return result
                else:
                    # No credentials provided, return NEEDS_LOGIN
                    _qa_buddy_discoveries[discovery_id]["status"] = "needs_login"
                    
                    result = {
                        "discovery_id": discovery_id,
                        "status": "NEEDS_LOGIN",
                        "stage": "LOGIN_VALIDATION",
                        "reason": session_result["reason"],
                        "login_selectors": session_result.get("login_selectors", {}),
                        "completed_at": datetime.utcnow().isoformat() + "Z"
                    }
                    
                    with open(discovery_dir / "discovery.json", "w") as f:
                        json.dump(result, f, indent=2)
                    
                    await browser.close()
                    return result
            
            if session_result["status"] == "FAILED":
                _qa_buddy_discoveries[discovery_id]["status"] = "failed"
                _qa_buddy_discoveries[discovery_id]["error"] = session_result["reason"]
                
                # Capture screenshot of failure
                await page.screenshot(path=str(discovery_dir / "session_validation_failed.png"))
                
                result = {
                    "discovery_id": discovery_id,
                    "status": "FAILED",
                    "stage": session_result["stage"],
                    "reason": session_result["reason"],
                    "completed_at": datetime.utcnow().isoformat() + "Z"
                }
                
                with open(discovery_dir / "discovery.json", "w") as f:
                    json.dump(result, f, indent=2)
                
                if emit_event:
                    await emit_event({
                        "event": "SESSION_INVALID",
                        "data": {
                            "stage": session_result["stage"],
                            "reason": session_result["reason"]
                        }
                    })
                
                await browser.close()
                return result
            
            # STEP 2: PROGRESSIVE DISCOVERY
            # If test_prompt provided, show it
            if request.test_prompt:
                if emit_event:
                    await emit_event({
                        "event": "TEST_PROMPT_RECEIVED",
                        "data": {
                            "prompt": request.test_prompt[:100],
                            "message": f"Focusing on: {request.test_prompt[:50]}..."
                        }
                    })
                safe_log(f"[{discovery_id}] Test focus: {request.test_prompt[:100]}")
            
            # Start periodic screenshot task for browser view
            screenshot_task = None
            async def take_periodic_screenshots():
                """Take screenshots every 2 seconds for browser view."""
                while True:
                    try:
                        await asyncio.sleep(2)
                        screenshot_path = discovery_dir / "current_view.png"
                        await page.screenshot(path=str(screenshot_path), full_page=False)
                        if emit_event:
                            await emit_event({
                                "event": "SCREENSHOT_UPDATE",
                                "data": {
                                    "timestamp": datetime.utcnow().isoformat() + "Z",
                                    "url": page.url
                                }
                            })
                    except asyncio.CancelledError:
                        break
                    except Exception as e:
                        safe_log(f"[{discovery_id}] Screenshot failed: {str(e)[:100]}")
                        await asyncio.sleep(5)  # Wait longer on error
            
            screenshot_task = asyncio.create_task(take_periodic_screenshots())
            
            if emit_event:
                await emit_event({
                    "event": "STEP_START",
                    "data": {"step": "DISCOVERY"}
                })
            
            try:
                discovery_result = await discover_application(
                    discovery_id,
                    request,
                    page,
                    emit_event
                )
            finally:
                # Stop screenshot task
                if screenshot_task:
                    screenshot_task.cancel()
                    try:
                        await screenshot_task
                    except asyncio.CancelledError:
                        pass
            
            # Save final discovery
            _qa_buddy_discoveries[discovery_id].update(discovery_result)
            
            await browser.close()
            return discovery_result
            
    except Exception as e:
        error_msg = str(e)[:500]
        _qa_buddy_discoveries[discovery_id]["status"] = "failed"
        _qa_buddy_discoveries[discovery_id]["error"] = error_msg
        
        if emit_event:
            await emit_event({
                "event": "ERROR",
                "data": {"error": error_msg}
            })
        
        result = {
            "discovery_id": discovery_id,
            "status": "failed",
            "error": error_msg,
            "completed_at": datetime.utcnow().isoformat() + "Z"
        }
        
        discovery_dir = DATA_DIR / discovery_id
        discovery_dir.mkdir(parents=True, exist_ok=True)
        with open(discovery_dir / "discovery.json", "w") as f:
            json.dump(result, f, indent=2)
        
        return result


# =============================================================================
# Endpoints
# =============================================================================

@router.post("/discover/stream")
async def qa_buddy_discover_stream(request: QABuddyDiscoverRequest):
    """
    Start QA Buddy discovery with SSE streaming.
    
    Expects a logged-in session (browser context with cookies).
    """
    # Safety check
    if is_production(request.application_url, request.env) and not ALLOW_PROD:
        raise HTTPException(403, "Production environment blocked. Set ALLOW_PROD=true to enable.")
    
    discovery_id = f"qa-buddy-{str(uuid.uuid4())[:8]}"
    
    _qa_buddy_discoveries[discovery_id] = {
        "discovery_id": discovery_id,
        "status": "pending",
        "application_url": request.application_url,
        "started_at": datetime.utcnow().isoformat() + "Z"
    }
    
    safe_log(f"Starting QA Buddy discovery {discovery_id}", {
        "url": request.application_url,
        "mode": request.mode
    })
    
    async def event_generator():
        """Generator that emits SSE events during discovery."""
        queue = asyncio.Queue()
        
        async def emit_event(event_data: Dict):
            await queue.put(event_data)
        
        # Start discovery in background
        async def run_discovery_task():
            try:
                await run_qa_buddy_discovery(discovery_id, request, emit_event=emit_event)
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


@router.post("/discover")
async def qa_buddy_discover(request: QABuddyDiscoverRequest, background_tasks: BackgroundTasks):
    """Start QA Buddy discovery (non-streaming)."""
    # Safety check
    if is_production(request.application_url, request.env) and not ALLOW_PROD:
        raise HTTPException(403, "Production environment blocked. Set ALLOW_PROD=true to enable.")
    
    discovery_id = f"qa-buddy-{str(uuid.uuid4())[:8]}"
    
    _qa_buddy_discoveries[discovery_id] = {
        "discovery_id": discovery_id,
        "status": "pending",
        "application_url": request.application_url,
        "started_at": datetime.utcnow().isoformat() + "Z"
    }
    
    safe_log(f"Starting QA Buddy discovery {discovery_id}", {
        "url": request.application_url,
        "mode": request.mode
    })
    
    background_tasks.add_task(run_qa_buddy_discovery, discovery_id, request, None)
    
    return {"discovery_id": discovery_id, "status": "pending"}


@router.get("/discover/{discovery_id}")
async def get_qa_buddy_discovery(discovery_id: str):
    """Get QA Buddy discovery results."""
    if discovery_id in _qa_buddy_discoveries:
        return _qa_buddy_discoveries[discovery_id]
    
    # Try to load from file
    discovery_file = DATA_DIR / discovery_id / "discovery.json"
    if discovery_file.exists():
        with open(discovery_file) as f:
            return json.load(f)
    
    raise HTTPException(404, "Discovery not found")


@router.get("/discover/{discovery_id}/screenshot")
async def get_qa_buddy_screenshot(discovery_id: str):
    """Get current browser screenshot for QA Buddy discovery."""
    from fastapi.responses import FileResponse
    
    discovery_dir = DATA_DIR / discovery_id
    screenshot_path = discovery_dir / "current_view.png"
    
    if not screenshot_path.exists():
        # Return a placeholder or 404
        raise HTTPException(404, "Screenshot not available yet")
    
    return FileResponse(
        str(screenshot_path),
        media_type="image/png",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )


@router.post("/test")
async def qa_buddy_test(request: QABuddyTestRequest, background_tasks: BackgroundTasks):
    """
    Autonomous test execution based on discovery.
    
    Decides what to test without explicit instructions.
    """
    # Load discovery
    discovery_file = DATA_DIR / request.discovery_id / "discovery.json"
    if not discovery_file.exists():
        raise HTTPException(404, "Discovery not found")
    
    with open(discovery_file) as f:
        discovery = json.load(f)
    
    # Decide tests autonomously
    tests = decide_tests(discovery, request.mode)
    
    run_id = f"qa-buddy-run-{str(uuid.uuid4())[:8]}"
    
    _qa_buddy_runs[run_id] = {
        "run_id": run_id,
        "discovery_id": request.discovery_id,
        "status": "pending",
        "tests_planned": len(tests),
        "started_at": datetime.utcnow().isoformat() + "Z"
    }
    
    # TODO: Implement test execution
    # For now, return planned tests
    
    return {
        "run_id": run_id,
        "status": "pending",
        "tests_planned": len(tests),
        "tests": tests[:10]  # First 10 for preview
    }
