"""Login executor service for generic and Keycloak authentication."""

import asyncio
import logging
from pathlib import Path
import re
from typing import Dict, Any, Optional, List
from urllib.parse import urlparse

from app.models.ai_config import AIConfig
from app.models.run_state import RunState
from app.models.run_context import Question
from app.services.ai.provider_factory import get_llm_provider

logger = logging.getLogger(__name__)

MAX_LOGIN_ATTEMPTS = 3


class LoginExecutor:
    """Service for executing login attempts against generic and Keycloak login forms."""

    # Expanded selector lists — ordered from most specific to most generic
    USERNAME_SELECTORS = [
        "input#username",
        "input[name='username']",
        "input[name*='user' i]",
        "input[name*='login' i]",
        "input#email",
        "input[name='email']",
        "input[name*='email' i]",
        "input[type='email']",
        "input[placeholder*='email' i]",
        "input[placeholder*='username' i]",
        "input[placeholder*='user' i]",
        "input[aria-label*='email' i]",
        "input[aria-label*='username' i]",
        "input[aria-label*='user' i]",
        "input[autocomplete='username']",
        "input[autocomplete='email']",
        "input[type='text']:first-of-type",
    ]
    PASSWORD_SELECTORS = [
        "input#password",
        "input[name='password']",
        "input[name*='pass' i]",
        "input[type='password']",
        # Common MUI input classes (Outlined/Standard/Filled)
        "input.MuiInputBase-input",
        "input.MuiOutlinedInput-input",
        "input.MuiInput-input",
        "input[placeholder*='password' i]",
        "input[aria-label*='password' i]",
        "input[aria-label*='pass' i]",
        "input[autocomplete='current-password']",
    ]
    SUBMIT_SELECTORS = [
        "button[type='submit']",
        "input[type='submit']",
        "#kc-login",
        # MUI buttons frequently used for submit/login
        "button.MuiButtonBase-root[type='submit']",
        "button.MuiButton-root[type='submit']",
        "button[class*='MuiButton' i][type='submit']",
        "button:has-text('Sign in')",
        "button:has-text('Log in')",
        "button:has-text('Login')",
        "button:has-text('Continue')",
        "button:has-text('Next')",
        "[role='button']:has-text('Sign in')",
        "[role='button']:has-text('Login')",
        "[role='button']:has-text('Continue')",
    ]
    # Some apps show a "Login" entry point first (no fields yet).
    # Try clicking these before failing with "no username field found".
    LOGIN_ENTRY_SELECTORS = [
        "button:has-text('Login')",
        "button:has-text('Log in')",
        "button:has-text('Sign in')",
        "a:has-text('Login')",
        "a:has-text('Log in')",
        "a:has-text('Sign in')",
        "[role='button']:has-text('Login')",
        "[role='button']:has-text('Log in')",
        "[role='button']:has-text('Sign in')",
        "text=/\\b(login|log\\s*in|sign\\s*in)\\b/i",
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
    WRONG_CREDENTIALS_RE = re.compile(
        r"(invalid|incorrect|wrong).*(password|credential|username|email)|"
        r"(password|credential|username|email).*(invalid|incorrect|wrong)|"
        r"unauthori[sz]ed|forbidden|bad credentials|authentication failed",
        re.IGNORECASE,
    )

    def __init__(self):
        self._login_attempts: Dict[str, int] = {}  # Track login attempts per run

    async def attempt_login(
        self,
        page,
        run_id: str,
        base_url: str,
        username: str,
        password: str,
        artifacts_path: str,
        ai_config: Optional[AIConfig] = None,
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
                    id="human_login_bypass",
                    type="confirm",
                    text=(
                        f"Login automation seems stuck after {MAX_LOGIN_ATTEMPTS} attempts.\n\n"
                        "Please complete login manually in the browser (human takeover), then confirm.\n"
                        "If you cannot log in, choose No and we'll retry credentials."
                    ),
                    screenshot_path=screenshot_path if Path(screenshot_path).exists() else None
                )
                return {
                    "status": "timeout",
                    "next_state": RunState.WAIT_LOGIN_CONFIRM,
                    "question": question,
                    "error_message": f"Login automation stuck after {MAX_LOGIN_ATTEMPTS} attempts; human takeover requested.",
                    "screenshot_path": screenshot_path
                }

            url_before = page.url
            logger.info(f"[{run_id}] Attempt {attempt_count}/{MAX_LOGIN_ATTEMPTS} from URL: {url_before}")

            # Step 1: Fill username / email
            username_filled = await self._fill_first_match(page, run_id, self.USERNAME_SELECTORS, username, "username")
            if not username_filled:
                # Try to open login form (some apps show only a Login button first)
                opened = await self._try_open_login_form(page, run_id)
                if opened:
                    username_filled = await self._fill_first_match(page, run_id, self.USERNAME_SELECTORS, username, "username")

            if not username_filled and ai_config and ai_config.enabled and ai_config.provider != "none":
                # AI fallback: choose the best "login entry" candidate to click.
                try:
                    ai_clicked = await self._ai_try_open_login_form(
                        page=page,
                        run_id=run_id,
                        artifacts_path=artifacts_path,
                        ai_config=ai_config,
                    )
                    if ai_clicked:
                        username_filled = await self._fill_first_match(
                            page, run_id, self.USERNAME_SELECTORS, username, "username"
                        )
                except Exception as e:
                    logger.debug(f"[{run_id}] AI login-entry fallback failed: {e}")

            if not username_filled:
                artifacts_dir = Path(artifacts_path)
                artifacts_dir.mkdir(parents=True, exist_ok=True)
                screenshot_path = str(artifacts_dir / "login_click_required.png")
                try:
                    await page.screenshot(path=screenshot_path)
                except Exception:
                    pass

                question = Question(
                    id="login_click_required",
                    type="confirm",
                    text=(
                        "I can't find the username/email field yet. Some apps show a 'Login/Sign in' button first "
                        "(or a popup blocks the form). Please click the Login/Sign in button in the browser, "
                        "ensure the username/password fields are visible, then confirm."
                    ),
                    screenshot_path=screenshot_path if Path(screenshot_path).exists() else None,
                )
                return {
                    "status": "timeout",
                    "next_state": RunState.WAIT_LOGIN_CONFIRM,
                    "question": question,
                    "error_message": "Login form not visible; user click required",
                    "screenshot_path": screenshot_path,
                }

            # Step 2: Fill password
            password_filled = await self._fill_first_match(page, run_id, self.PASSWORD_SELECTORS, password, "password")

            if not password_filled:
                raise Exception("Could not find password field")

            # Step 3: Click submit and wait for navigation
            submitted = await self._submit_login(
                page=page,
                run_id=run_id,
                artifacts_path=artifacts_path,
                ai_config=ai_config,
            )

            if not submitted:
                raise Exception("Could not submit login (no submit button / click blocked)")

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
                is_wrong_creds = self._looks_like_wrong_credentials(error_message)
                guidance = (
                    "Wrong credentials (username/password). Please retry with correct credentials."
                    if is_wrong_creds
                    else "Login blocked by an obstacle on the page. Please retry after fixing it."
                )
                question = Question(
                    id="login_error",
                    type="text",
                    text=(
                        f"Login failed: {error_message}. "
                        f"Attempt {attempt_count}/{MAX_LOGIN_ATTEMPTS}. "
                        f"{guidance}"
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
                    f"Login attempt failed due to an obstacle: {str(e)[:200]}. "
                    "Please retry with credentials again. If the issue persists, the login form may be non-standard/SSO-only."
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

    async def _fill_first_match(self, page, run_id: str, selectors: list, value: str, field_name: str) -> bool:
        for selector in selectors:
            try:
                loc = await self._first_locator_any_frame(page, selector)
                if not loc:
                    continue

                # Best-effort: make interactable
                try:
                    await loc.scroll_into_view_if_needed()
                except Exception:
                    pass
                try:
                    await loc.click(timeout=3000)
                except Exception:
                    pass

                # Try fill first
                try:
                    await loc.fill(value, timeout=5000)
                    logger.info(f"[{run_id}] Filled {field_name} using: {selector}")
                    return True
                except Exception:
                    # Some frameworks block fill(); type like a human
                    try:
                        await loc.click(timeout=3000)
                    except Exception:
                        pass
                    try:
                        await loc.press("Control+A")
                        await loc.press("Backspace")
                    except Exception:
                        pass
                    await loc.type(value, delay=35)
                    logger.info(f"[{run_id}] Typed {field_name} using: {selector}")
                    return True
            except Exception as e:
                logger.debug(f"[{run_id}] {field_name} selector {selector} failed: {e}")
        return False

    async def _first_locator_any_frame(self, page, selector: str):
        """
        Find a matching locator in main frame or iframes.
        Many IdP/login providers render fields inside an iframe.
        """
        try:
            loc = page.locator(selector)
            if await loc.count() > 0:
                return loc.first
        except Exception:
            pass

        try:
            for frame in page.frames:
                try:
                    if frame == page.main_frame:
                        continue
                    floc = frame.locator(selector)
                    if await floc.count() > 0:
                        return floc.first
                except Exception:
                    continue
        except Exception:
            pass

        return None

    async def _try_open_login_form(self, page, run_id: str) -> bool:
        try:
            for selector in self.LOGIN_ENTRY_SELECTORS:
                try:
                    loc = page.locator(selector).first
                    count = await loc.count()
                    if count <= 0:
                        continue
                    try:
                        await loc.scroll_into_view_if_needed()
                    except Exception:
                        pass
                    await loc.click(timeout=5000)
                    logger.info(f"[{run_id}] Clicked login entry using: {selector}")
                    try:
                        await page.wait_for_load_state("networkidle", timeout=15000)
                    except Exception:
                        pass
                    await asyncio.sleep(1)
                    return True
                except Exception as e:
                    logger.debug(f"[{run_id}] Login entry selector {selector} failed: {e}")
        except Exception as e:
            logger.debug(f"[{run_id}] Error trying to open login form: {e}")
        return False

    async def _submit_login(
        self,
        page,
        run_id: str,
        artifacts_path: str,
        ai_config: Optional[AIConfig],
    ) -> bool:
        """
        Submit strategies (in order):
        1) Click obvious submit/login buttons (incl. MUI)
        2) Press Enter in password field
        3) Submit the nearest form element via JS
        4) AI fallback: choose the best submit candidate by visible text
        """
        # Strategy 1: click known submit selectors
        for selector in self.SUBMIT_SELECTORS:
            try:
                loc = await self._first_locator_any_frame(page, selector)
                if not loc:
                    continue
                try:
                    await loc.scroll_into_view_if_needed()
                except Exception:
                    pass
                try:
                    async with page.expect_navigation(timeout=30000, wait_until="networkidle"):
                        await loc.click(timeout=7000)
                    logger.info(f"[{run_id}] Clicked submit using: {selector}, waiting for redirect")
                    return True
                except asyncio.TimeoutError:
                    await loc.click(timeout=7000)
                    logger.info(f"[{run_id}] Clicked submit using: {selector}, navigation timeout")
                    await asyncio.sleep(2)
                    return True
            except Exception as e:
                logger.debug(f"[{run_id}] Submit selector {selector} failed: {e}")

        # Strategy 2: press Enter on password field (common for MUI/login forms)
        try:
            pw = await self._first_locator_any_frame(page, "input[type='password'], input[name*='pass' i], input.MuiInputBase-input")
            if pw:
                try:
                    await pw.focus()
                except Exception:
                    pass
                await pw.press("Enter")
                logger.info(f"[{run_id}] Submitted login by pressing Enter in password field")
                try:
                    await page.wait_for_load_state("networkidle", timeout=15000)
                except Exception:
                    pass
                await asyncio.sleep(1)
                return True
        except Exception as e:
            logger.debug(f"[{run_id}] Enter-submit failed: {e}")

        # Strategy 3: submit nearest form via JS (works when button click is blocked)
        try:
            any_input = await self._first_locator_any_frame(
                page,
                "input[type='password'], input[type='email'], input[type='text'], input.MuiInputBase-input",
            )
            if any_input:
                submitted = await any_input.evaluate(
                    """(el) => {
                      const form = el.closest('form');
                      if (!form) return false;
                      if (typeof form.requestSubmit === 'function') { form.requestSubmit(); return true; }
                      if (typeof form.submit === 'function') { form.submit(); return true; }
                      return false;
                    }"""
                )
                if submitted:
                    logger.info(f"[{run_id}] Submitted login by form.requestSubmit()/submit()")
                    try:
                        await page.wait_for_load_state("networkidle", timeout=15000)
                    except Exception:
                        pass
                    await asyncio.sleep(1)
                    return True
        except Exception as e:
            logger.debug(f"[{run_id}] Form submit fallback failed: {e}")

        # Strategy 4: AI fallback pick best submit button text and click it
        if ai_config and ai_config.enabled and ai_config.provider != "none":
            try:
                candidates = await self._collect_login_submit_candidates(page)
                if candidates:
                    provider_config = {
                        "enabled": ai_config.enabled,
                        "provider": ai_config.provider,
                        "model_name": ai_config.model_name,
                        "api_key": ai_config.api_key,
                        "base_url": ai_config.base_url,
                        "temperature": ai_config.temperature,
                        "max_tokens": ai_config.max_tokens,
                        "timeout": ai_config.timeout,
                    }
                    llm = get_llm_provider(provider_config)
                    if llm:
                        try:
                            if not await llm.is_available():
                                return False
                        except Exception:
                            return False

                        artifacts_dir = Path(artifacts_path)
                        artifacts_dir.mkdir(parents=True, exist_ok=True)
                        try:
                            await page.screenshot(path=str(artifacts_dir / "ai_submit.png"))
                        except Exception:
                            pass

                        schema = {
                            "type": "object",
                            "properties": {"chosen_text": {"type": "string"}},
                            "required": ["chosen_text"],
                        }
                        prompt = (
                            "Pick the best button/link text to submit the login form.\n"
                            f"URL: {page.url}\n"
                            "Candidates:\n" + "\n".join(f"- {c}" for c in candidates) + "\n"
                            "Return JSON with chosen_text exactly matching one candidate."
                        )
                        result = await llm.generate_structured(
                            prompt=prompt,
                            schema=schema,
                            system_prompt="Return only valid JSON.",
                            temperature=0.2,
                        )
                        chosen = (result.get("chosen_text") or "").strip()
                        if chosen and chosen in candidates:
                            try:
                                loc = page.locator(f"text={chosen}").first
                                await loc.scroll_into_view_if_needed()
                                await loc.click(timeout=7000)
                                logger.info(f"[{run_id}] AI clicked submit by text: {chosen}")
                                try:
                                    await page.wait_for_load_state("networkidle", timeout=15000)
                                except Exception:
                                    pass
                                await asyncio.sleep(1)
                                return True
                            except Exception as e:
                                logger.debug(f"[{run_id}] AI-chosen submit click failed: {e}")
            except Exception as e:
                logger.debug(f"[{run_id}] AI submit fallback failed: {e}")

        return False

    async def _collect_login_submit_candidates(self, page, limit: int = 20) -> List[str]:
        """Collect likely submit button texts (Login/Sign in/Continue/Next/Submit)."""
        try:
            loc = page.locator("button, [role='button'], input[type='submit'], a")
            count = await loc.count()
            out: List[str] = []
            for i in range(min(count, 250)):
                if len(out) >= limit:
                    break
                try:
                    t = (await loc.nth(i).inner_text()).strip()
                    t = re.sub(r"\\s+", " ", t)
                    if not t or len(t) > 60:
                        continue
                    if re.search(r"\\b(login|log\\s*in|sign\\s*in|continue|next|submit|verify)\\b", t, re.IGNORECASE):
                        if t not in out:
                            out.append(t)
                except Exception:
                    continue
            return out
        except Exception:
            return []

    async def _ai_try_open_login_form(
        self,
        page,
        run_id: str,
        artifacts_path: str,
        ai_config: AIConfig,
    ) -> bool:
        """
        AI-assisted fallback to click a "Login/Sign in" entry point when the form fields
        aren't visible yet. This is model/provider agnostic via LLMProvider.
        """
        provider_config = {
            "enabled": ai_config.enabled,
            "provider": ai_config.provider,
            "model_name": ai_config.model_name,
            "api_key": ai_config.api_key,
            "base_url": ai_config.base_url,
            "temperature": ai_config.temperature,
            "max_tokens": ai_config.max_tokens,
            "timeout": ai_config.timeout,
        }
        llm = get_llm_provider(provider_config)
        if not llm:
            return False
        try:
            if not await llm.is_available():
                return False
        except Exception:
            # If availability check fails, be conservative and skip AI
            return False

        candidates = await self._collect_login_entry_candidates(page)
        if not candidates:
            return False

        artifacts_dir = Path(artifacts_path)
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        screenshot_path = str(artifacts_dir / "ai_login_entry.png")
        try:
            await page.screenshot(path=screenshot_path)
        except Exception:
            screenshot_path = ""

        schema = {
            "type": "object",
            "properties": {
                "chosen_text": {"type": "string", "description": "Exact visible text of the best login entry to click"},
                "reason": {"type": "string"},
            },
            "required": ["chosen_text"],
        }
        prompt = (
            "You are helping automate a web login with Playwright.\n"
            "The login form fields (username/password) are not visible yet.\n"
            "Choose the best candidate that, when clicked, is most likely to open the login form.\n\n"
            f"Current URL: {page.url}\n"
            "Candidates (visible texts):\n"
            + "\n".join(f"- {t}" for t in candidates)
            + "\n\nReturn JSON with field 'chosen_text' exactly matching one candidate."
        )
        result = await llm.generate_structured(
            prompt=prompt,
            schema=schema,
            system_prompt="Return only valid JSON. Do not invent candidates.",
            temperature=0.2,
        )

        chosen = (result.get("chosen_text") or "").strip()
        if not chosen or chosen not in candidates:
            return False

        try:
            loc = page.locator(f"text={chosen}").first
            await loc.scroll_into_view_if_needed()
            await loc.click(timeout=5000)
            logger.info(f"[{run_id}] AI clicked login entry by text: {chosen}")
            try:
                await page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:
                pass
            await asyncio.sleep(1)
            return True
        except Exception as e:
            logger.debug(f"[{run_id}] AI-chosen login entry click failed: {e}")
            return False

    async def _collect_login_entry_candidates(self, page, limit: int = 20) -> List[str]:
        """
        Collect likely login-entry texts from buttons/links/role=button.
        Keeps it cheap and model-friendly.
        """
        try:
            # Prefer semantic targets first
            loc = page.locator("button, [role='button'], a")
            count = await loc.count()
            out: List[str] = []
            for i in range(min(count, 200)):  # cap traversal
                if len(out) >= limit:
                    break
                try:
                    t = (await loc.nth(i).inner_text()).strip()
                    t = re.sub(r"\s+", " ", t)
                    if not t or len(t) > 60:
                        continue
                    if re.search(r"\b(login|log\s*in|sign\s*in)\b", t, re.IGNORECASE):
                        if t not in out:
                            out.append(t)
                except Exception:
                    continue
            return out
        except Exception:
            return []

    def _looks_like_wrong_credentials(self, error_text: str) -> bool:
        if not error_text:
            return False
        return bool(self.WRONG_CREDENTIALS_RE.search(error_text))

    def reset_attempts(self, run_id: str):
        """Reset login attempts counter for a run."""
        if run_id in self._login_attempts:
            del self._login_attempts[run_id]


# Global login executor instance
_login_executor = LoginExecutor()


def get_login_executor() -> LoginExecutor:
    """Get global login executor instance."""
    return _login_executor
