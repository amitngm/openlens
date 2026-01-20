"""Login detection service for Keycloak-first behavior."""

import logging
from typing import Dict, Any, Optional

from app.models.run_state import RunState
from app.models.run_context import Question, AuthConfig

logger = logging.getLogger(__name__)


class LoginDetector:
    """Service for detecting login requirements and preparing login flow."""
    
    async def detect_login(
        self,
        run_id: str,
        context: Any,  # RunContext
        keycloak_detected: bool = True
    ) -> Dict[str, Any]:
        """
        Detect login requirements and determine next state.
        
        Args:
            run_id: Run identifier
            context: RunContext object
            keycloak_detected: Whether Keycloak was detected in SESSION_CHECK
        
        Returns:
            Dict with:
                - next_state: RunState
                - question: Optional[Question] (if credentials needed)
                - auth_updated: bool (if auth.type was updated)
        """
        try:
            # If Keycloak detected, ensure auth.type is set
            auth_updated = False
            if keycloak_detected:
                if not context.auth:
                    # Create new auth config with Keycloak type
                    context.auth = AuthConfig(type="keycloak")
                    auth_updated = True
                    logger.info(f"[{run_id}] Created auth config with type=keycloak")
                elif context.auth.type != "keycloak":
                    # Update existing auth config to Keycloak
                    context.auth.type = "keycloak"
                    auth_updated = True
                    logger.info(f"[{run_id}] Updated auth type to keycloak")
            
            # Check if credentials are available
            has_username = context.auth and context.auth.username
            has_password = context.auth and context.auth.password
            has_credentials = has_username and has_password
            
            if not has_credentials:
                # Credentials missing - ask for them
                logger.info(f"[{run_id}] Credentials missing - requesting input")
                question = Question(
                    id="login_creds",
                    type="text",
                    text="Please provide login credentials. Format: 'username,password' or JSON {\"username\":\"...\",\"password\":\"...\"}. Alternatively, provide a profile name if configured."
                )
                
                return {
                    "next_state": RunState.WAIT_LOGIN_INPUT,
                    "question": question,
                    "auth_updated": auth_updated
                }
            else:
                # Credentials exist - proceed to login attempt
                logger.info(f"[{run_id}] Credentials available - proceeding to login attempt")
                return {
                    "next_state": RunState.LOGIN_ATTEMPT,
                    "question": None,
                    "auth_updated": auth_updated
                }
        
        except Exception as e:
            logger.error(f"[{run_id}] Login detection failed: {e}", exc_info=True)
            # On error, default to asking for credentials
            question = Question(
                id="login_creds",
                type="text",
                text="Please provide login credentials. Format: 'username,password' or JSON {\"username\":\"...\",\"password\":\"...\"}"
            )
            return {
                "next_state": RunState.WAIT_LOGIN_INPUT,
                "question": question,
                "auth_updated": False
            }


# Global login detector instance
_login_detector = LoginDetector()


def get_login_detector() -> LoginDetector:
    """Get global login detector instance."""
    return _login_detector
