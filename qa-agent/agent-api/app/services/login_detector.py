"""Login detection service for generic and Keycloak-first behavior."""

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
        keycloak_detected: bool = True,
        login_form_detected: bool = False,
        auth_type: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Detect login requirements and determine next state.

        Args:
            run_id: Run identifier
            context: RunContext object
            keycloak_detected: Whether Keycloak was detected in SESSION_CHECK
            login_form_detected: Whether a generic login form was detected
            auth_type: Explicit auth type override (e.g. 'keycloak', 'generic_form')

        Returns:
            Dict with:
                - next_state: RunState
                - question: Optional[Question] (if credentials needed)
                - auth_updated: bool (if auth.type was updated)
        """
        try:
            auth_updated = False

            # Determine effective auth type
            if auth_type:
                effective_type = auth_type
            elif keycloak_detected:
                effective_type = "keycloak"
            elif login_form_detected:
                effective_type = "generic_form"
            else:
                effective_type = None

            # Apply auth type to context
            if effective_type:
                if not context.auth:
                    context.auth = AuthConfig(type=effective_type)
                    auth_updated = True
                    logger.info(f"[{run_id}] Created auth config with type={effective_type}")
                elif context.auth.type != effective_type:
                    context.auth.type = effective_type
                    auth_updated = True
                    logger.info(f"[{run_id}] Updated auth type to {effective_type}")
            else:
                # No login detected — ensure auth is not None so downstream code is safe
                if context.auth is None:
                    context.auth = AuthConfig(type="none")
                    auth_updated = True
                    logger.info(f"[{run_id}] No login detected; set auth type=none")

            # Check if credentials are available
            has_username = context.auth and context.auth.username
            has_password = context.auth and context.auth.password
            has_credentials = has_username and has_password

            if not has_credentials:
                logger.info(f"[{run_id}] Credentials missing - requesting input")
                question = Question(
                    id="login_creds",
                    type="text",
                    text=(
                        "Please provide login credentials for any username/email and password. "
                        "Format: 'username,password' or JSON {\"username\":\"...\",\"password\":\"...\"}. "
                        "Alternatively, provide a profile name if configured."
                    )
                )
                return {
                    "next_state": RunState.WAIT_LOGIN_INPUT,
                    "question": question,
                    "auth_updated": auth_updated
                }
            else:
                logger.info(f"[{run_id}] Credentials available - proceeding to login attempt")
                return {
                    "next_state": RunState.LOGIN_ATTEMPT,
                    "question": None,
                    "auth_updated": auth_updated
                }

        except Exception as e:
            logger.error(f"[{run_id}] Login detection failed: {e}", exc_info=True)
            question = Question(
                id="login_creds",
                type="text",
                text=(
                    "Please provide login credentials for any username/email and password. "
                    "Format: 'username,password' or JSON {\"username\":\"...\",\"password\":\"...\"}"
                )
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
