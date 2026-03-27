"""Session check service for detecting login state."""

import asyncio
import logging
import re
from pathlib import Path
from typing import Dict, Any, Optional

from app.models.run_state import RunState
from app.models.run_context import Question

logger = logging.getLogger(__name__)

# Score thresholds
LOGIN_REQUIRED_THRESHOLD = 50   # Very confident it is a login page
LOGIN_AMBIGUOUS_THRESHOLD = 20  # Possibly a login page — ask the user


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
        "form#kc-form-login",
    ]

    # Login form selectors (generic)
    LOGIN_FORM_SELECTORS = [
        "input[type='password']",
        "input[name='password']",
        "#password",
        "form:has(input[type='password'])",
    ]

    async def check_session(
        self,
        page,
        base_url: str,
        run_id: str,
        artifacts_path: str,
        skip_initial_navigation: bool = False,
    ) -> Dict[str, Any]:
        """
        Check if user is already logged in or needs login.

        Args:
            page: Playwright Page object
            base_url: Base application URL
            run_id: Run identifier
            artifacts_path: Path to artifacts directory
            skip_initial_navigation: If True, do not call ``goto(base_url)`` — score the **current**
                page only. Use after manual steps or free-text clicks so we do not reset SSO/IdP
                navigation.

        Returns:
            Dict with:
                - status: "logged_in" | "login_required" | "ambiguous"
                - next_state: RunState
                - question: Optional[Question] (if ambiguous / unexpected)
                - screenshot_path: str
                - auth_type: str ("keycloak" | "generic_form" | "none")
        """
        try:
            if not skip_initial_navigation:
                logger.info(f"[{run_id}] Opening base URL: {base_url}")
                # domcontentloaded first — many SPAs never reach "networkidle" (polling/WebSockets)
                await page.goto(base_url, timeout=45000, wait_until="domcontentloaded")
                try:
                    await page.wait_for_load_state("networkidle", timeout=15000)
                except Exception:
                    logger.info(
                        f"[{run_id}] Session check: networkidle not reached in 15s (normal for SPAs); continuing"
                    )
                try:
                    await page.wait_for_load_state("domcontentloaded")
                except Exception:
                    pass
                await asyncio.sleep(0.5)
            else:
                logger.info(f"[{run_id}] Session check without navigation (current URL: {page.url})")
                try:
                    await page.wait_for_load_state("networkidle", timeout=10000)
                except Exception:
                    pass
                try:
                    await page.wait_for_load_state("domcontentloaded")
                except Exception:
                    pass
                await asyncio.sleep(0.8)

            current_url = page.url
            logger.info(f"[{run_id}] Current URL for session check: {current_url}")

            # Capture screenshot
            artifacts_dir = Path(artifacts_path)
            artifacts_dir.mkdir(parents=True, exist_ok=True)
            screenshot_path = str(artifacts_dir / "session_check.png")
            await page.screenshot(path=screenshot_path)
            logger.info(f"[{run_id}] Screenshot saved: {screenshot_path}")

            # Score the page for login likelihood
            score = await self._score_login_page(page, current_url)
            logger.info(f"[{run_id}] Login page score: {score}/100")

            # Determine auth_type for the result
            url_lower = current_url.lower()
            if any(p in url_lower for p in self.KEYCLOAK_URL_PATTERNS):
                auth_type = "keycloak"
            elif score >= LOGIN_REQUIRED_THRESHOLD:
                auth_type = "generic_form"
            else:
                auth_type = "none"

            if score >= LOGIN_REQUIRED_THRESHOLD:
                logger.info(f"[{run_id}] Login required (score={score}) — auth_type={auth_type}")
                return {
                    "status": "login_required",
                    "next_state": RunState.LOGIN_DETECT,
                    "question": None,
                    "screenshot_path": screenshot_path,
                    "auth_type": auth_type
                }

            if score >= LOGIN_AMBIGUOUS_THRESHOLD:
                logger.warning(f"[{run_id}] Ambiguous login page (score={score}) — asking user")
                question = Question(
                    id="login_confirm",
                    type="confirm",
                    text=(
                        "I detected what might be a login page (not certain). "
                        "Are you already logged in?"
                    ),
                    screenshot_path=screenshot_path
                )
                return {
                    "status": "ambiguous",
                    "next_state": RunState.WAIT_LOGIN_CONFIRM,
                    "question": question,
                    "screenshot_path": screenshot_path,
                    "auth_type": auth_type
                }

            # Low score — check for logged-in indicators
            is_logged_in = await self._has_logged_in_indicators(page)

            if is_logged_in:
                logger.info(f"[{run_id}] Logged-in indicators found — session valid")
                return {
                    "status": "logged_in",
                    "next_state": RunState.CONTEXT_DETECT,
                    "question": None,
                    "screenshot_path": screenshot_path,
                    "auth_type": "none"
                }

            # No login form, no nav/dashboard — unexpected screen
            logger.warning(f"[{run_id}] Unexpected screen (score={score}, no login indicators)")
            question = Question(
                id="unexpected_screen",
                type="confirm",
                text=(
                    "I’m on an unexpected screen (not clearly a login page, and not clearly logged-in).\n\n"
                    "Please take the next manual step in the browser (e.g., close a popup, click Continue, choose a tenant, "
                    "complete a captcha/SSO step), then confirm and I’ll re-check and continue."
                ),
                screenshot_path=screenshot_path
            )
            return {
                "status": "ambiguous",
                "next_state": RunState.WAIT_UNEXPECTED_SCREEN,
                "question": question,
                "screenshot_path": screenshot_path,
                "auth_type": "none"
            }

        except Exception as e:
            logger.error(f"[{run_id}] Session check failed: {e}", exc_info=True)
            artifacts_dir = Path(artifacts_path)
            artifacts_dir.mkdir(parents=True, exist_ok=True)
            screenshot_path = str(artifacts_dir / "session_check_error.png")
            try:
                await page.screenshot(path=screenshot_path)
            except Exception:
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
                "screenshot_path": screenshot_path,
                "auth_type": "none"
            }

    # ------------------------------------------------------------------
    # Scoring
    # ------------------------------------------------------------------

    async def _score_login_page(self, page, current_url: str) -> int:
        """
        Return a score 0-100 estimating how likely the current page is a login page.

        Scoring breakdown:
          +50  Keycloak URL patterns (/realms/, openid-connect)
          +10  URL contains login-related keyword
          +30  Has a visible password field
          +10  Has a username/email field
          +5   Page title contains login-related keyword
        """
        score = 0
        url_lower = current_url.lower()

        # Keycloak bonus (very high confidence)
        if "/realms/" in url_lower or "openid-connect" in url_lower:
            score += 50

        # URL signals
        for kw in ["login", "signin", "sign-in", "auth", "sso", "account/login"]:
            if kw in url_lower:
                score += 10
                break

        # Has password field
        try:
            pw_count = await page.locator("input[type='password']").count()
            if pw_count > 0:
                score += 30
        except Exception:
            pass

        # Has username/email field
        try:
            for sel in [
                "input[type='email']",
                "input[name='username']",
                "input[name='email']",
            ]:
                c = await page.locator(sel).count()
                if c > 0:
                    score += 10
                    break
        except Exception:
            pass

        # Page title signals
        try:
            title = await page.title()
            for kw in ["login", "sign in", "sign-in", "authentication"]:
                if kw in title.lower():
                    score += 5
                    break
        except Exception:
            pass

        # OAuth / SSO entry pages: only a "Login" / "Sign in" CTA, password field appears after click
        score += await self._score_oauth_login_entry_boost(page)

        return min(score, 100)

    async def _score_oauth_login_entry_boost(self, page) -> int:
        """
        Add score when the page is clearly an auth entry (button/link) but fields are on the next step.
        Avoids classifying marketing landings as WAIT_UNEXPECTED_SCREEN when there is no password input yet.
        """
        try:
            if await page.locator("input[type='password']").count() > 0:
                return 0
        except Exception:
            pass
        try:
            for role in ("button", "link"):
                loc = page.get_by_role(
                    role, name=re.compile(r"^(login|sign in|log in)$", re.I)
                )
                if await loc.count() > 0:
                    return 45
            # Icon+label buttons (e.g. door icon + "Login") — match label substring
            loc2 = page.get_by_role("button", name=re.compile(r"login|sign in|log in", re.I))
            if await loc2.count() > 0:
                return 45
            for role in ("button", "link"):
                su = page.get_by_role(role, name=re.compile(r"^sign up$", re.I))
                if await su.count() > 0:
                    return 40
            su2 = page.get_by_role("link", name=re.compile(r"sign up", re.I))
            if await su2.count() > 0:
                return 40
        except Exception as e:
            logger.debug(f"OAuth login entry boost error: {e}")
        return 0

    # ------------------------------------------------------------------
    # Legacy helper methods (kept as internal helpers used by _score_login_page)
    # ------------------------------------------------------------------

    async def _detect_keycloak(self, page, current_url: str) -> bool:
        """Detect if current page is Keycloak login."""
        url_lower = current_url.lower()
        for pattern in self.KEYCLOAK_URL_PATTERNS:
            if pattern in url_lower:
                logger.debug(f"Keycloak detected in URL: {pattern}")
                return True

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
            ".context-selector",
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
