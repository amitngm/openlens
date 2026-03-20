"""Login executor service for generic and Keycloak authentication."""

import asyncio
import logging
from pathlib import Path
from typing import Dict, Any, Optional
from urllib.parse import urlparse

from app.models.run_state import RunState
from app.models.run_context import Question

logger = logging.getLogger(__name__)

MAX_LOGIN_ATTEMPTS = 3


class LoginExecutor:
    """Service for executing login attempts against generic and Keycloak login forms."""

    # Expanded selector lists — ordered from most specific to most generic
    USERNAME_SELECTORS = [
        "input#username",
        "input[name='username']",
        "input#email",
        "input[name='email']",
        "input[type='email']",
        "input[placeholder*='email' i]",
        "input[placeholder*='username' i]",
        "input[placeholder*='user' i]",
        "input[autocomplete='username']",
        "input[autocomplete='email']",
        "input[type='text']:first-of-type",
    ]
    PASSWORD_SELECTORS = [
        "input#password",
        "input[name='password']",
        "input[type='password']",
        "input[placeholder*='password' i]",
        "input[autocomplete='current-password']",
    ]
    SUBMIT_SELECTORS = [
        "button[type='submit']",
        "input[type='submit']",
        "#kc-login",
        "button:has-text('Sign in')",
        "button:has-text('Log in')",
        "button:has-text('Login')",
        "button:has-text('Continue')",
        "button:has-text('Next')",
        "[role='button']:has-text('Sign in')",
    ]
    GENERIC_ERROR_SELECTORS = [
        ".kc-feedback-text",
        ".alert-error",
        ".pf-m-danger",
        ".error-message",
        "[role='alert']",
        ".alert-danger",
        ".error",
        ".form-error",
        "[data-testid*='error']",
        ".notification-error",
        "p:has-text('invalid')",
        "p:has-text('incorrect')",
        "span:has-text('Invalid credentials')",
        "div:has-text('Login failed')",
    ]

    # Keycloak URL patterns (kept for backward compat)
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
        Attempt a generic (or Keycloak) login.

        Args:
            page: Playwright Page object
            run_id: Run identifier
            base_url: Base application URL
            username: Username / email for login
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
            attempt_count = self._login_attempts[run_id]

            # Hard stop after MAX_LOGIN_ATTEMPTS
            if attempt_count > MAX_LOGIN_ATTEMPTS:
                logger.warning(f"[{run_id}] Login failed after {MAX_LOGIN_ATTEMPTS} attempts")
                artifacts_dir = Path(artifacts_path)
                artifacts_dir.mkdir(parents=True, exist_ok=True)
                screenshot_path = str(artifacts_dir / "login_loop.png")
                try:
                    await page.screenshot(path=screenshot_path)
                except Exception:
                    pass

                question = Question(
                    id="login_loop",
                    type="text",
                    text=(
                        f"Login failed after {MAX_LOGIN_ATTEMPTS} attempts. "
                        "Please verify credentials."
                    ),
                    screenshot_path=screenshot_path if Path(screenshot_path).exists() else None
                )
                return {
                    "status": "loop",
                    "next_state": RunState.FAILED,
                    "question": question,
                    "error_message": f"Login failed after {MAX_LOGIN_ATTEMPTS} attempts. Please verify credentials.",
                    "screenshot_path": screenshot_path
                }

            url_before = page.url
            logger.info(f"[{run_id}] Attempt {attempt_count}/{MAX_LOGIN_ATTEMPTS} from URL: {url_before}")

            # Step 1: Fill username / email
            username_filled = False
            for selector in self.USERNAME_SELECTORS:
                try:
                    count = await page.locator(selector).count()
                    if count > 0:
                        await page.locator(selector).first.fill(username)
                        username_filled = True
                        logger.info(f"[{run_id}] Filled username using: {selector}")
                        break
                except Exception as e:
                    logger.debug(f"[{run_id}] Username selector {selector} failed: {e}")

            if not username_filled:
                raise Exception("Could not find username/email field")

            # Step 2: Fill password
            password_filled = False
            for selector in self.PASSWORD_SELECTORS:
                try:
                    count = await page.locator(selector).count()
                    if count > 0:
                        await page.locator(selector).first.fill(password)
                        password_filled = True
                        logger.info(f"[{run_id}] Filled password using: {selector}")
                        break
                except Exception as e:
                    logger.debug(f"[{run_id}] Password selector {selector} failed: {e}")

            if not password_filled:
                raise Exception("Could not find password field")

            # Step 3: Click submit and wait for navigation
            submit_clicked = False
            for selector in self.SUBMIT_SELECTORS:
                try:
                    count = await page.locator(selector).count()
                    if count > 0:
                        try:
                            async with page.expect_navigation(timeout=30000, wait_until="networkidle"):
                                await page.locator(selector).first.click()
                            submit_clicked = True
                            logger.info(f"[{run_id}] Clicked submit using: {selector}, waiting for redirect")
                            break
                        except asyncio.TimeoutError:
                            await page.locator(selector).first.click()
                            submit_clicked = True
                            logger.info(f"[{run_id}] Clicked submit using: {selector}, navigation timeout")
                            await asyncio.sleep(3)
                            break
                except Exception as e:
                    logger.debug(f"[{run_id}] Submit selector {selector} failed: {e}")

            if not submit_clicked:
                raise Exception("Could not find submit button")

            # Wait for page to stabilize
            try:
                await page.wait_for_load_state("networkidle", timeout=20000)
                await asyncio.sleep(2)
            except Exception:
                await asyncio.sleep(2)

            url_after = page.url
            logger.info(f"[{run_id}] URL after login: {url_after}")

            # Capture screenshot
            artifacts_dir = Path(artifacts_path)
            artifacts_dir.mkdir(parents=True, exist_ok=True)
            screenshot_path = str(artifacts_dir / "login_attempt.png")
            await page.screenshot(path=screenshot_path)

            # Step 4: SSO redirect detection — landed on a third-party domain
            base_parsed = urlparse(base_url)
            after_parsed = urlparse(url_after)
            if (
                after_parsed.netloc
                and after_parsed.netloc != base_parsed.netloc
                and not self._is_keycloak_url(url_after)
            ):
                logger.info(
                    f"[{run_id}] SSO redirect detected: {url_after} "
                    f"(different from base {base_url})"
                )
                question = Question(
                    id="sso_redirect",
                    type="confirm",
                    text=(
                        f"The browser was redirected to an SSO/OAuth page: {url_after}\n"
                        "If your browser completed SSO login manually, please confirm. "
                        "Otherwise cancel and check your SSO configuration."
                    ),
                    screenshot_path=screenshot_path
                )
                return {
                    "status": "timeout",
                    "next_state": RunState.WAIT_LOGIN_CONFIRM,
                    "question": question,
                    "error_message": f"SSO redirect to {url_after}",
                    "screenshot_path": screenshot_path
                }

            # Step 5: Check for error messages on the page
            error_message = await self._check_for_errors(page)
            if error_message:
                logger.warning(f"[{run_id}] Login error detected: {error_message}")
                question = Question(
                    id="login_error",
                    type="text",
                    text=(
                        f"Login failed: {error_message}. "
                        f"Attempt {attempt_count}/{MAX_LOGIN_ATTEMPTS}. "
                        "Please check credentials and try again."
                    ),
                    screenshot_path=screenshot_path
                )
                return {
                    "status": "failure",
                    "next_state": RunState.WAIT_LOGIN_INPUT,
                    "question": question,
                    "error_message": error_message,
                    "screenshot_path": screenshot_path
                }

            # Step 6: Check success criteria
            is_success = await self._check_success(url_after, base_url, page)

            if is_success:
                logger.info(f"[{run_id}] Login successful")
                self._login_attempts[run_id] = 0
                return {
                    "status": "success",
                    "next_state": RunState.POST_LOGIN_VALIDATE,
                    "question": None,
                    "error_message": None,
                    "screenshot_path": screenshot_path
                }

            # Still on a login/auth page — uncertain
            still_keycloak = self._is_keycloak_url(url_after)
            uncertainty_text = (
                "Still on Keycloak page after login attempt. Did login succeed?"
                if still_keycloak
                else "Login status uncertain. Did the login succeed?"
            )
            question = Question(
                id="login_uncertain",
                type="confirm",
                text=uncertainty_text,
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
            except Exception:
                pass

            question = Question(
                id="login_error",
                type="text",
                text=(
                    f"Login attempt failed: {str(e)[:200]}. "
                    "Please check credentials and try again."
                ),
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
            for selector in self.GENERIC_ERROR_SELECTORS:
                try:
                    count = await page.locator(selector).count()
                    if count > 0:
                        error_text = await page.locator(selector).first.inner_text()
                        if error_text and error_text.strip():
                            return error_text.strip()[:200]
                except Exception:
                    continue
        except Exception as e:
            logger.debug(f"Error checking for errors: {e}")

        return None

    async def _check_success(self, current_url: str, base_url: str, page) -> bool:
        """
        Check if login was successful (generic, not Keycloak-only).

        Success criteria:
        1. No password field currently visible on the page.
        2. URL host matches base_url host (or is a sub/parent domain thereof)
           OR the URL is an intermediate redirect that will settle on the base domain.
        3. URL does NOT contain Keycloak patterns.
        """
        try:
            base_parsed = urlparse(base_url)
            current_parsed = urlparse(current_url)

            base_host = base_parsed.netloc.lower()
            current_host = current_parsed.netloc.lower()

            # Criterion 1: password field no longer visible
            try:
                pw_count = await page.locator("input[type='password']:visible").count()
                if pw_count > 0:
                    logger.debug("Password field still visible — login not complete")
                    return False
            except Exception:
                pass

            # Criterion 2: host must relate to base_url
            host_match = (
                current_host == base_host
                or current_host.endswith("." + base_host)
                or base_host.endswith("." + current_host)
            )
            if not host_match:
                logger.debug(f"Host mismatch after login: {current_host} vs {base_host}")
                return False

            # Criterion 3: not still on a Keycloak URL
            if self._is_keycloak_url(current_url):
                logger.debug("Still on Keycloak URL — login not complete")
                return False

            logger.debug(f"Login success criteria met: host={current_host}")
            return True

        except Exception as e:
            logger.error(f"Error checking login success: {e}")
            return False

    def _is_keycloak_url(self, url: str) -> bool:
        """Check if URL is a Keycloak URL (backward compat)."""
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
