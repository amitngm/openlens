"""Post-login validation service to verify session is established."""

import asyncio
import logging
from pathlib import Path
from typing import Dict, Any
from urllib.parse import urlparse

from app.models.run_state import RunState
from app.models.run_context import Question

logger = logging.getLogger(__name__)


class PostLoginValidator:
    """Service for validating post-login session."""
    
    # Keycloak URL patterns
    KEYCLOAK_PATTERNS = ["/realms/", "openid-connect"]
    
    async def validate_session(
        self,
        page,
        run_id: str,
        base_url: str,
        artifacts_path: str
    ) -> Dict[str, Any]:
        """
        Validate that login session is established and we don't bounce back to Keycloak.
        
        Args:
            page: Playwright Page object
            run_id: Run identifier
            base_url: Base application URL
            artifacts_path: Path to artifacts directory
        
        Returns:
            Dict with:
                - status: "valid" | "bounced"
                - next_state: RunState
                - question: Optional[Question] (if bounced)
                - current_url: str
                - screenshot_path: str
        """
        try:
            # Step 1: Reload base_url once
            logger.info(f"[{run_id}] Post-login validation: Reloading base URL: {base_url}")
            await page.goto(base_url, timeout=30000, wait_until="networkidle")
            await asyncio.sleep(2)  # Wait for any redirects
            
            # Get current URL after reload
            current_url = page.url
            logger.info(f"[{run_id}] Current URL after reload: {current_url}")
            
            # Capture screenshot
            artifacts_dir = Path(artifacts_path)
            artifacts_dir.mkdir(parents=True, exist_ok=True)
            screenshot_path = str(artifacts_dir / "post_login_validate.png")
            await page.screenshot(path=screenshot_path)
            logger.info(f"[{run_id}] Screenshot saved: {screenshot_path}")
            
            # Step 2: Check if we bounced back to Keycloak
            is_keycloak = self._is_keycloak_url(current_url)
            
            if is_keycloak:
                logger.warning(f"[{run_id}] Session validation failed - bounced back to Keycloak")
                question = Question(
                    id="session_not_established",
                    type="text",
                    text="Session not established / still redirecting to Keycloak. Please check credentials and try again.",
                    screenshot_path=screenshot_path
                )
                
                return {
                    "status": "bounced",
                    "next_state": RunState.WAIT_LOGIN_INPUT,
                    "question": question,
                    "current_url": current_url,
                    "screenshot_path": screenshot_path
                }
            
            # Step 3: Additional check - verify we're on the app domain
            base_parsed = urlparse(base_url)
            current_parsed = urlparse(current_url)
            
            base_host = base_parsed.netloc.lower()
            current_host = current_parsed.netloc.lower()
            
            # Check if host matches (exact or parent domain)
            host_match = (
                current_host == base_host or
                current_host.endswith("." + base_host) or
                base_host.endswith("." + current_host)
            )
            
            if not host_match:
                logger.warning(f"[{run_id}] Host mismatch: {current_host} vs {base_host}")
                # This might be a redirect to a different domain, but not Keycloak
                # Could be legitimate (e.g., CDN, different subdomain)
                # We'll allow it but log a warning
            
            # Session appears valid
            logger.info(f"[{run_id}] Session validation successful - on app domain")
            return {
                "status": "valid",
                "next_state": RunState.CONTEXT_DETECT,
                "question": None,
                "current_url": current_url,
                "screenshot_path": screenshot_path
            }
        
        except Exception as e:
            logger.error(f"[{run_id}] Post-login validation failed: {e}", exc_info=True)
            # On error, capture screenshot and default to asking for credentials
            artifacts_dir = Path(artifacts_path)
            artifacts_dir.mkdir(parents=True, exist_ok=True)
            screenshot_path = str(artifacts_dir / "post_login_validate_error.png")
            try:
                await page.screenshot(path=screenshot_path)
                current_url = page.url
            except:
                current_url = "unknown"
                screenshot_path = None
            
            question = Question(
                id="session_not_established",
                type="text",
                text=f"Session validation failed: {str(e)[:200]}. Please check credentials and try again.",
                screenshot_path=screenshot_path if screenshot_path and Path(screenshot_path).exists() else None
            )
            
            return {
                "status": "bounced",
                "next_state": RunState.WAIT_LOGIN_INPUT,
                "question": question,
                "current_url": current_url,
                "screenshot_path": screenshot_path
            }
    
    def _is_keycloak_url(self, url: str) -> bool:
        """Check if URL is a Keycloak URL."""
        url_lower = url.lower()
        return any(pattern in url_lower for pattern in self.KEYCLOAK_PATTERNS)


# Global post-login validator instance
_post_login_validator = PostLoginValidator()


def get_post_login_validator() -> PostLoginValidator:
    """Get global post-login validator instance."""
    return _post_login_validator
