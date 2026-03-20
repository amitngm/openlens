"""Browser manager for Playwright context management per run."""

import logging
import platform
import subprocess
import sys
from typing import Optional, Dict, Any
from pathlib import Path

try:
    from playwright.async_api import async_playwright, Browser, BrowserContext, Page
except ImportError:
    async_playwright = None
    Browser = None
    BrowserContext = None
    Page = None

logger = logging.getLogger(__name__)


class BrowserManager:
    """Manages Playwright browser contexts per run."""
    
    def __init__(self):
        self._browsers: Dict[str, Browser] = {}
        self._contexts: Dict[str, BrowserContext] = {}
        self._pages: Dict[str, Page] = {}
        self._playwright = None
        self._browser_engine_by_run: Dict[str, str] = {}
    
    async def initialize(self):
        """Initialize Playwright."""
        if async_playwright is None:
            raise ImportError("playwright is not installed. Install with: pip install playwright && playwright install")

        if self._playwright is None:
            self._playwright = await async_playwright().start()
            logger.info("Playwright initialized")

    async def _ensure_browsers_installed(self) -> bool:
        """
        Ensure Playwright browsers are installed.

        Automatically installs browsers if they're missing.
        Works across macOS, Linux, and Windows.

        Returns:
            bool: True if browsers are available, False if installation failed
        """
        try:
            # macOS + recent Playwright may choose "chromium_headless_shell" for headless Chromium.
            # On some macOS setups this binary can crash (SIGSEGV). Use Firefox for the
            # smoke-test so runs aren't blocked by the headless shell path.
            test_engine = "firefox" if platform.system() == "Darwin" else "chromium"
            test_browser = await getattr(self._playwright, test_engine).launch(headless=True)
            await test_browser.close()
            logger.info("Playwright browsers already installed")
            return True
        except Exception as e:
            error_msg = str(e)

            # Check if error is about missing executable
            if "Executable doesn't exist" in error_msg or "browserType.launch" in error_msg:
                logger.warning("Playwright browsers not found, installing automatically...")

                # Detect OS
                os_type = platform.system()  # Returns: 'Darwin' (macOS), 'Linux', 'Windows'
                logger.info(f"Detected OS: {os_type}")

                try:
                    # Run playwright install command
                    # --with-deps flag installs system dependencies on Linux
                    cmd = [sys.executable, "-m", "playwright", "install", "--with-deps", "chromium"]

                    logger.info(f"Running: {' '.join(cmd)}")

                    result = subprocess.run(
                        cmd,
                        capture_output=True,
                        text=True,
                        timeout=300  # 5 minutes timeout
                    )

                    if result.returncode == 0:
                        logger.info("Playwright browsers installed successfully")
                        logger.info(f"Installation output: {result.stdout}")
                        return True
                    else:
                        logger.error(f"Playwright installation failed: {result.stderr}")
                        return False

                except subprocess.TimeoutExpired:
                    logger.error("Playwright installation timed out after 5 minutes")
                    return False
                except Exception as install_error:
                    logger.error(f"Failed to install Playwright browsers: {install_error}")
                    return False
            else:
                # Different error, re-raise
                raise

    async def get_or_create_context(
        self,
        run_id: str,
        headless: bool = True,
        debug: bool = False,
        artifacts_path: Optional[str] = None,
        slow_mo_ms: int = 0
    ) -> BrowserContext:
        """
        Get or create a browser context for a run.
        
        Args:
            run_id: Run identifier
            headless: Run browser in headless mode
        
        Returns:
            BrowserContext
        """
        if run_id in self._contexts:
            return self._contexts[run_id]
        
        if self._playwright is None:
            await self.initialize()
        
        # Debug mode forces headed + slowMo + video recording
        launch_headless = False if debug else headless
        launch_slow_mo = 200 if debug else slow_mo_ms

        # Ensure browsers are installed (auto-install if missing)
        if not await self._ensure_browsers_installed():
            raise RuntimeError(
                "Failed to install Playwright browsers automatically. "
                f"Please run manually: python -m playwright install --with-deps chromium"
            )

        # Launch browser
        # Prefer Chromium for headed/debug runs. On macOS, headless Chromium may route to
        # "chromium_headless_shell" which can crash on some machines, so use Firefox for headless.
        is_macos = platform.system() == "Darwin"

        # If you want the run to open *Google Chrome* specifically, Playwright supports
        # this via the "chrome" channel (uses the locally installed Chrome).
        # We'll prefer Chrome for headed/debug runs (so you can watch it),
        # and also try it for headless if available.
        engine = "chromium"
        launch_kwargs: Dict[str, Any] = {
            "headless": launch_headless,
            "slow_mo": launch_slow_mo,
        }

        if is_macos:
            # Prefer using installed Google Chrome.
            launch_kwargs["channel"] = "chrome"

            # On some macOS setups, Playwright's default headless Chromium shell can crash.
            # Using the Chrome channel avoids that in many cases; if it still fails, we'll fall back.
            if launch_headless:
                engine = "chromium"

        logger.info(
            f"[{run_id}] Launching browser engine={engine} "
            f"(headless={launch_headless}, channel={launch_kwargs.get('channel')})"
        )

        try:
            browser = await getattr(self._playwright, engine).launch(**launch_kwargs)
        except Exception:
            # Fallback: try the other engine once to keep the run moving.
            fallback = "firefox" if engine == "chromium" else "chromium"
            logger.warning(
                f"[{run_id}] Failed launching engine={engine} (channel={launch_kwargs.get('channel')}). "
                f"Falling back to {fallback}.",
                exc_info=True,
            )

            # If falling back to firefox, drop chrome-specific kwargs.
            if fallback == "firefox":
                launch_kwargs.pop("channel", None)

            browser = await getattr(self._playwright, fallback).launch(**launch_kwargs)
            engine = fallback

        self._browser_engine_by_run[run_id] = engine
        self._browsers[run_id] = browser

        context_kwargs = {
            "viewport": {"width": 1920, "height": 1080},
            "ignore_https_errors": True,
        }

        # Record video in debug mode
        if debug and artifacts_path:
            video_dir = Path(artifacts_path) / "video"
            video_dir.mkdir(parents=True, exist_ok=True)
            context_kwargs["record_video_dir"] = str(video_dir)
            context_kwargs["record_video_size"] = {"width": 1280, "height": 720}

        context = await browser.new_context(**context_kwargs)
        self._contexts[run_id] = context
        
        logger.info(f"Created browser context for run: {run_id}")
        return context
    
    async def get_page(
        self,
        run_id: str,
        headless: bool = True,
        debug: bool = False,
        artifacts_path: Optional[str] = None
    ) -> Page:
        """
        Get or create a page for a run.
        
        Args:
            run_id: Run identifier
        
        Returns:
            Page
        """
        if run_id in self._pages:
            return self._pages[run_id]
        
        context = await self.get_or_create_context(
            run_id,
            headless=headless,
            debug=debug,
            artifacts_path=artifacts_path
        )
        page = await context.new_page()
        self._pages[run_id] = page
        
        logger.info(f"Created page for run: {run_id}")
        return page
    
    async def close_context(self, run_id: str) -> None:
        """Close browser context for a run."""
        if run_id in self._pages:
            try:
                await self._pages[run_id].close()
            except:
                pass
            del self._pages[run_id]
        
        if run_id in self._contexts:
            try:
                await self._contexts[run_id].close()
            except:
                pass
            del self._contexts[run_id]
        
        if run_id in self._browsers:
            try:
                await self._browsers[run_id].close()
            except:
                pass
            del self._browsers[run_id]
        
        logger.info(f"Closed browser context for run: {run_id}")
    
    async def close_all(self) -> None:
        """Close all browser contexts."""
        run_ids = list(self._contexts.keys())
        for run_id in run_ids:
            await self.close_context(run_id)
        
        if self._playwright:
            await self._playwright.stop()
            self._playwright = None
            logger.info("Playwright stopped")


# Global browser manager instance
_browser_manager = BrowserManager()


def get_browser_manager() -> BrowserManager:
    """Get global browser manager instance."""
    return _browser_manager
