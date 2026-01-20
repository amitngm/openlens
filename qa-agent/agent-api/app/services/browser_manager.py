"""Browser manager for Playwright context management per run."""

import logging
from typing import Optional, Dict
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
    
    async def initialize(self):
        """Initialize Playwright."""
        if async_playwright is None:
            raise ImportError("playwright is not installed. Install with: pip install playwright && playwright install")
        
        if self._playwright is None:
            self._playwright = await async_playwright().start()
            logger.info("Playwright initialized")
    
    async def get_or_create_context(
        self,
        run_id: str,
        headless: bool = True
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
        
        browser = await self._playwright.chromium.launch(headless=headless)
        self._browsers[run_id] = browser
        
        context = await browser.new_context(
            viewport={"width": 1920, "height": 1080},
            ignore_https_errors=True
        )
        self._contexts[run_id] = context
        
        logger.info(f"Created browser context for run: {run_id}")
        return context
    
    async def get_page(self, run_id: str) -> Page:
        """
        Get or create a page for a run.
        
        Args:
            run_id: Run identifier
        
        Returns:
            Page
        """
        if run_id in self._pages:
            return self._pages[run_id]
        
        context = await self.get_or_create_context(run_id)
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
