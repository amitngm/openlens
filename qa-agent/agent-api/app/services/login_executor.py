"""Login executor service for Keycloak authentication."""

import asyncio
import logging
from pathlib import Path
from typing import Dict, Any, Optional
from urllib.parse import urlparse

from app.models.run_state import RunState
from app.models.run_context import Question

logger = logging.getLogger(__name__)


class LoginExecutor:
    """Service for executing Keycloak login attempts."""
    
    # Selectors with fallbacks
    USERNAME_SELECTORS = "input#username, input[name='username'], input[type='text']"
    PASSWORD_SELECTORS = "input#password, input[name='password'], input[type='password']"
    SUBMIT_SELECTORS = "input[type='submit'], button[type='submit'], #kc-login"
    ERROR_SELECTORS = ".kc-feedback-text, .alert-error, .pf-m-danger, .error-message, [role='alert']"
    
    # Keycloak URL patterns
    KEYCLOAK_PATTERNS = ["/realms/", "openid-connect"]
    
    def __init__(self):
        self._login_attempts: Dict[str, int] = {}  # Track login attempts per run
    
    async def attempt_login(
        self,
        page,
        run_id: str,
        base_url: str,
        username: str,
        password: str,
        artifacts_path: str
    ) -> Dict[str, Any]:
        """
        Attempt Keycloak login.
        
        Args:
            page: Playwright Page object
            run_id: Run identifier
            base_url: Base application URL
            username: Username for login
            password: Password for login
            artifacts_path: Path to artifacts directory
        
        Returns:
            Dict with:
                - status: "success" | "failure" | "timeout" | "loop"
                - next_state: RunState
                - question: Optional[Question] (if failure/timeout/loop)
                - error_message: Optional[str]
                - screenshot_path: str
        """
        try:
            # Track login attempts
            if run_id not in self._login_attempts:
                self._login_attempts[run_id] = 0
            self._login_attempts[run_id] += 1
            
            # Check for login loop
            if self._login_attempts[run_id] > 2:
                logger.warning(f"[{run_id}] Login loop detected (>2 redirects to Keycloak)")
                artifacts_dir = Path(artifacts_path)
                artifacts_dir.mkdir(parents=True, exist_ok=True)
                screenshot_path = str(artifacts_dir / "login_loop.png")
                try:
                    await page.screenshot(path=screenshot_path)
                except:
                    pass
                
                question = Question(
                    id="login_loop",
                    type="text",
                    text=f"Login loop detected (redirected to Keycloak {self._login_attempts[run_id]} times). Please check credentials or session. Current URL: {page.url}",
                    screenshot_path=screenshot_path if Path(screenshot_path).exists() else None
                )
                
                return {
                    "status": "loop",
                    "next_state": RunState.WAIT_LOGIN_INPUT,
                    "question": question,
                    "error_message": "Login loop detected",
                    "screenshot_path": screenshot_path
                }
            
            # Get current URL before login
            url_before = page.url
            logger.info(f"[{run_id}] Attempting login from URL: {url_before}")
            
            # Step 1: Fill username
            username_filled = False
            for selector in self.USERNAME_SELECTORS.split(", "):
                try:
                    selector = selector.strip()
                    count = await page.locator(selector).count()
                    if count > 0:
                        await page.locator(selector).first.fill(username)
                        username_filled = True
                        logger.info(f"[{run_id}] Filled username using: {selector}")
                        break
                except Exception as e:
                    logger.debug(f"[{run_id}] Failed selector {selector}: {e}")
                    continue
            
            if not username_filled:
                raise Exception("Could not find username field")
            
            # Step 2: Fill password
            password_filled = False
            for selector in self.PASSWORD_SELECTORS.split(", "):
                try:
                    selector = selector.strip()
                    count = await page.locator(selector).count()
                    if count > 0:
                        await page.locator(selector).first.fill(password)
                        password_filled = True
                        logger.info(f"[{run_id}] Filled password using: {selector}")
                        break
                except Exception as e:
                    logger.debug(f"[{run_id}] Failed selector {selector}: {e}")
                    continue
            
            if not password_filled:
                raise Exception("Could not find password field")
            
            # Step 3: Click submit and wait for navigation
            submit_clicked = False
            for selector in self.SUBMIT_SELECTORS.split(", "):
                try:
                    selector = selector.strip()
                    count = await page.locator(selector).count()
                    if count > 0:
                        # Try to wait for navigation
                        try:
                            async with page.expect_navigation(timeout=30000, wait_until="networkidle"):
                                await page.locator(selector).first.click()
                            submit_clicked = True
                            logger.info(f"[{run_id}] Clicked submit using: {selector}, waiting for redirect")
                            break
                        except asyncio.TimeoutError:
                            # Navigation timeout, but button was clicked
                            await page.locator(selector).first.click()
                            submit_clicked = True
                            logger.info(f"[{run_id}] Clicked submit using: {selector}, navigation timeout")
                            # Wait a bit for redirect
                            await asyncio.sleep(3)
                            break
                except Exception as e:
                    logger.debug(f"[{run_id}] Failed selector {selector}: {e}")
                    continue
            
            if not submit_clicked:
                raise Exception("Could not find submit button")
            
            # Wait for page to stabilize
            try:
                await page.wait_for_load_state("networkidle", timeout=20000)
                await asyncio.sleep(2)  # Additional wait for redirect
            except:
                await asyncio.sleep(2)
            
            # Get URL after login attempt
            url_after = page.url
            logger.info(f"[{run_id}] URL after login: {url_after}")
            
            # Capture screenshot
            artifacts_dir = Path(artifacts_path)
            artifacts_dir.mkdir(parents=True, exist_ok=True)
            screenshot_path = str(artifacts_dir / "login_attempt.png")
            await page.screenshot(path=screenshot_path)
            
            # Step 4: Check for errors
            error_message = await self._check_for_errors(page)
            if error_message:
                logger.warning(f"[{run_id}] Login error detected: {error_message}")
                question = Question(
                    id="login_error",
                    type="text",
                    text=f"Login failed: {error_message}. Please check credentials and try again.",
                    screenshot_path=screenshot_path
                )
                return {
                    "status": "failure",
                    "next_state": RunState.WAIT_LOGIN_INPUT,
                    "question": question,
                    "error_message": error_message,
                    "screenshot_path": screenshot_path
                }
            
            # Step 5: Check success criteria
            is_success = self._check_success(url_after, base_url, page)
            
            if is_success:
                logger.info(f"[{run_id}] Login successful - redirected to app domain")
                # Reset login attempts on success
                self._login_attempts[run_id] = 0
                return {
                    "status": "success",
                    "next_state": RunState.POST_LOGIN_VALIDATE,
                    "question": None,
                    "error_message": None,
                    "screenshot_path": screenshot_path
                }
            
            # Check if still on Keycloak (potential loop)
            is_still_keycloak = self._is_keycloak_url(url_after)
            if is_still_keycloak:
                logger.warning(f"[{run_id}] Still on Keycloak after login attempt")
                # This will be caught by loop detection on next attempt
                question = Question(
                    id="login_uncertain",
                    type="confirm",
                    text="Login status uncertain. Still on Keycloak page. Did login succeed?",
                    screenshot_path=screenshot_path
                )
                return {
                    "status": "timeout",
                    "next_state": RunState.WAIT_LOGIN_CONFIRM,
                    "question": question,
                    "error_message": "Still on Keycloak after login",
                    "screenshot_path": screenshot_path
                }
            
            # Timeout/uncertain case
            logger.warning(f"[{run_id}] Login status uncertain - timeout or ambiguous redirect")
            question = Question(
                id="login_uncertain",
                type="confirm",
                text="Login status uncertain. Did the login succeed?",
                screenshot_path=screenshot_path
            )
            return {
                "status": "timeout",
                "next_state": RunState.WAIT_LOGIN_CONFIRM,
                "question": question,
                "error_message": "Login status uncertain",
                "screenshot_path": screenshot_path
            }
        
        except Exception as e:
            logger.error(f"[{run_id}] Login attempt failed: {e}", exc_info=True)
            artifacts_dir = Path(artifacts_path)
            artifacts_dir.mkdir(parents=True, exist_ok=True)
            screenshot_path = str(artifacts_dir / "login_error.png")
            try:
                await page.screenshot(path=screenshot_path)
            except:
                pass
            
            question = Question(
                id="login_error",
                type="text",
                text=f"Login attempt failed: {str(e)[:200]}. Please check credentials and try again.",
                screenshot_path=screenshot_path if Path(screenshot_path).exists() else None
            )
            return {
                "status": "failure",
                "next_state": RunState.WAIT_LOGIN_INPUT,
                "question": question,
                "error_message": str(e)[:200],
                "screenshot_path": screenshot_path
            }
    
    async def _check_for_errors(self, page) -> Optional[str]:
        """Check for error messages on the page."""
        try:
            for selector in self.ERROR_SELECTORS.split(", "):
                try:
                    selector = selector.strip()
                    count = await page.locator(selector).count()
                    if count > 0:
                        error_text = await page.locator(selector).first.inner_text()
                        if error_text and error_text.strip():
                            return error_text.strip()[:200]
                except:
                    continue
        except Exception as e:
            logger.debug(f"Error checking for errors: {e}")
        
        return None
    
    def _check_success(self, current_url: str, base_url: str, page) -> bool:
        """
        Check if login was successful (landing-page agnostic).
        
        Success criteria:
        - current URL host matches base_url host (or ends with same parent domain)
        - current URL does NOT contain '/realms/' and does NOT contain 'openid-connect'
        - keycloak login form not visible
        """
        try:
            # Parse URLs
            base_parsed = urlparse(base_url)
            current_parsed = urlparse(current_url)
            
            base_host = base_parsed.netloc.lower()
            current_host = current_parsed.netloc.lower()
            
            # Check 1: Host matches (exact or parent domain)
            host_match = (
                current_host == base_host or
                current_host.endswith("." + base_host) or
                base_host.endswith("." + current_host)
            )
            
            if not host_match:
                logger.debug(f"Host mismatch: {current_host} vs {base_host}")
                return False
            
            # Check 2: Not a Keycloak URL
            url_lower = current_url.lower()
            for pattern in self.KEYCLOAK_PATTERNS:
                if pattern in url_lower:
                    logger.debug(f"Still contains Keycloak pattern: {pattern}")
                    return False
            
            # Check 3: Keycloak login form not visible (async check needed)
            # We'll do a quick check, but this is best done with async
            # For now, if we pass host and URL checks, assume success
            # The form check can be done separately if needed
            
            logger.debug(f"Success criteria met: host={current_host}, no keycloak patterns")
            return True
        
        except Exception as e:
            logger.error(f"Error checking success: {e}")
            return False
    
    def _is_keycloak_url(self, url: str) -> bool:
        """Check if URL is a Keycloak URL."""
        url_lower = url.lower()
        return any(pattern in url_lower for pattern in self.KEYCLOAK_PATTERNS)
    
    def reset_attempts(self, run_id: str):
        """Reset login attempts counter for a run."""
        if run_id in self._login_attempts:
            del self._login_attempts[run_id]


# Global login executor instance
_login_executor = LoginExecutor()


def get_login_executor() -> LoginExecutor:
    """Get global login executor instance."""
    return _login_executor
