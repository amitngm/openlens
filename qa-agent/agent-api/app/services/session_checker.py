"""Session check service for detecting login state."""

import logging
from pathlib import Path
from typing import Dict, Any, Optional

from app.models.run_state import RunState
from app.models.run_context import Question

logger = logging.getLogger(__name__)


class SessionChecker:
    """Service for checking session/login state."""
    
    # Keycloak detection patterns
    KEYCLOAK_URL_PATTERNS = ["/realms/", "openid-connect"]
    KEYCLOAK_SELECTORS = [
        "#username",
        "#password",
        "input[name='username']",
        "input[name='password']",
        "#kc-login",
        "form#kc-form-login"
    ]
    
    # Login form selectors (generic)
    LOGIN_FORM_SELECTORS = [
        "input[type='password']",
        "input[name='password']",
        "#password",
        "form:has(input[type='password'])"
    ]
    
    async def check_session(
        self,
        page,
        base_url: str,
        run_id: str,
        artifacts_path: str
    ) -> Dict[str, Any]:
        """
        Check if user is already logged in or needs login.
        
        Args:
            page: Playwright Page object
            base_url: Base application URL
            run_id: Run identifier
            artifacts_path: Path to artifacts directory
        
        Returns:
            Dict with:
                - status: "logged_in" | "keycloak" | "ambiguous"
                - next_state: RunState
                - question: Optional[Question] (if ambiguous)
                - screenshot_path: str
        """
        try:
            # Navigate to base URL
            logger.info(f"[{run_id}] Opening base URL: {base_url}")
            await page.goto(base_url, timeout=30000, wait_until="networkidle")
            await page.wait_for_load_state("domcontentloaded")
            
            current_url = page.url
            logger.info(f"[{run_id}] Current URL after navigation: {current_url}")
            
            # Capture screenshot
            artifacts_dir = Path(artifacts_path)
            artifacts_dir.mkdir(parents=True, exist_ok=True)
            screenshot_path = str(artifacts_dir / "session_check.png")
            await page.screenshot(path=screenshot_path)
            logger.info(f"[{run_id}] Screenshot saved: {screenshot_path}")
            
            # Check 1: Keycloak detection
            is_keycloak = await self._detect_keycloak(page, current_url)
            
            if is_keycloak:
                logger.info(f"[{run_id}] Keycloak detected - login required")
                return {
                    "status": "keycloak",
                    "next_state": RunState.LOGIN_DETECT,
                    "question": None,
                    "screenshot_path": screenshot_path
                }
            
            # Check 2: Login form detection
            has_login_form = await self._has_login_form(page)
            
            if has_login_form:
                logger.info(f"[{run_id}] Login form detected - login required")
                return {
                    "status": "keycloak",  # Treat as login required
                    "next_state": RunState.LOGIN_DETECT,
                    "question": None,
                    "screenshot_path": screenshot_path
                }
            
            # Check 3: Logged-in indicators
            is_logged_in = await self._has_logged_in_indicators(page)
            
            if is_logged_in:
                logger.info(f"[{run_id}] Logged-in indicators found - session valid")
                return {
                    "status": "logged_in",
                    "next_state": RunState.CONTEXT_DETECT,
                    "question": None,
                    "screenshot_path": screenshot_path
                }
            
            # Ambiguous case - create confirm question
            logger.warning(f"[{run_id}] Session state ambiguous - asking user")
            question = Question(
                id="login_confirm",
                type="confirm",
                text="Login required? I am not sure. Are you already logged in?",
                screenshot_path=screenshot_path
            )
            
            return {
                "status": "ambiguous",
                "next_state": RunState.WAIT_LOGIN_CONFIRM,
                "question": question,
                "screenshot_path": screenshot_path
            }
        
        except Exception as e:
            logger.error(f"[{run_id}] Session check failed: {e}", exc_info=True)
            # On error, default to ambiguous
            artifacts_dir = Path(artifacts_path)
            artifacts_dir.mkdir(parents=True, exist_ok=True)
            screenshot_path = str(artifacts_dir / "session_check_error.png")
            try:
                await page.screenshot(path=screenshot_path)
            except:
                pass
            
            question = Question(
                id="login_confirm",
                type="confirm",
                text="Login required? I am not sure. Are you already logged in?",
                screenshot_path=screenshot_path if Path(screenshot_path).exists() else None
            )
            
            return {
                "status": "ambiguous",
                "next_state": RunState.WAIT_LOGIN_CONFIRM,
                "question": question,
                "screenshot_path": screenshot_path
            }
    
    async def _detect_keycloak(self, page, current_url: str) -> bool:
        """Detect if current page is Keycloak login."""
        # Check URL patterns
        url_lower = current_url.lower()
        for pattern in self.KEYCLOAK_URL_PATTERNS:
            if pattern in url_lower:
                logger.debug(f"Keycloak detected in URL: {pattern}")
                return True
        
        # Check for Keycloak form selectors
        try:
            for selector in self.KEYCLOAK_SELECTORS:
                count = await page.locator(selector).count()
                if count > 0:
                    logger.debug(f"Keycloak selector found: {selector}")
                    return True
        except Exception as e:
            logger.debug(f"Error checking Keycloak selectors: {e}")
        
        return False
    
    async def _has_login_form(self, page) -> bool:
        """Check if page has a login form."""
        try:
            for selector in self.LOGIN_FORM_SELECTORS:
                count = await page.locator(selector).count()
                if count > 0:
                    logger.debug(f"Login form selector found: {selector}")
                    return True
        except Exception as e:
            logger.debug(f"Error checking login form selectors: {e}")
        
        return False
    
    async def _has_logged_in_indicators(self, page) -> bool:
        """Check for indicators that user is logged in."""
        # Common logged-in indicators
        logged_in_selectors = [
            "nav",
            ".sidebar",
            ".menu",
            ".dashboard",
            ".user-menu",
            "[data-logged-in]",
            ".profile",
            ".avatar",
            "button:has-text('Logout')",
            "a:has-text('Logout')",
            ".tenant-selector",
            ".context-selector"
        ]
        
        try:
            for selector in logged_in_selectors:
                count = await page.locator(selector).count()
                if count > 0:
                    logger.debug(f"Logged-in indicator found: {selector}")
                    return True
        except Exception as e:
            logger.debug(f"Error checking logged-in indicators: {e}")
        
        return False


# Global session checker instance
_session_checker = SessionChecker()


def get_session_checker() -> SessionChecker:
    """Get global session checker instance."""
    return _session_checker
