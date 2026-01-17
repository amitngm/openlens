"""
Security guards for test execution.

Prevents accidental execution against production or non-test accounts.
"""

import logging
from typing import Dict, Any, Optional
from fastapi import HTTPException

from app.utils.config import settings

logger = logging.getLogger(__name__)


class GuardError(Exception):
    """Exception raised when a guard check fails."""
    pass


def check_env_guard(
    env: str,
    flow_name: str,
    force_allow: bool = False
) -> None:
    """
    Check if execution is allowed for the given environment.
    
    Args:
        env: Target environment (e.g., 'dev', 'staging', 'prod')
        flow_name: Name of the flow to execute
        force_allow: Override guard (requires explicit permission)
    
    Raises:
        GuardError: If execution is not allowed
    """
    if not settings.ENV_GUARD_ENABLED:
        logger.warning("ENV_GUARD is disabled - allowing all environments")
        return
    
    # Normalize environment name
    env_lower = env.lower().strip()
    
    # Production environments
    prod_keywords = ['prod', 'production', 'prd', 'live']
    is_production = any(kw in env_lower for kw in prod_keywords)
    
    if is_production:
        # Check allowlist
        if flow_name in settings.ENV_GUARD_PROD_ALLOWLIST:
            logger.info(
                f"ENV_GUARD: Flow '{flow_name}' is in production allowlist"
            )
            return
        
        if force_allow:
            logger.warning(
                f"ENV_GUARD: Force-allowing production execution for '{flow_name}' "
                f"in environment '{env}'"
            )
            return
        
        logger.error(
            f"ENV_GUARD: Blocked execution of '{flow_name}' in production "
            f"environment '{env}'"
        )
        raise GuardError(
            f"Execution blocked: Flow '{flow_name}' is not allowed in production "
            f"environment '{env}'. Add to ENV_GUARD_PROD_ALLOWLIST or use force_allow flag."
        )
    
    logger.debug(f"ENV_GUARD: Allowed execution in environment '{env}'")


def check_test_account_guard(
    variables: Dict[str, Any],
    tenant: Optional[str] = None
) -> None:
    """
    Verify that test account markers are present.
    
    Args:
        variables: Flow execution variables
        tenant: Tenant identifier
    
    Raises:
        GuardError: If test account markers are missing
    """
    if not settings.TEST_ACCOUNT_GUARD_ENABLED:
        logger.warning("TEST_ACCOUNT_GUARD is disabled")
        return
    
    # Check for testTenant variable
    test_tenant = variables.get('testTenant', False)
    
    if not test_tenant:
        logger.error(
            f"TEST_ACCOUNT_GUARD: Missing testTenant=true variable"
        )
        raise GuardError(
            "Execution blocked: 'testTenant=true' variable is required. "
            "This ensures tests run only on designated test accounts."
        )
    
    # Check tenant naming convention (optional additional check)
    if tenant:
        test_tenant_patterns = ['test', 'qa', 'automation', 'demo']
        is_test_tenant = any(
            pattern in tenant.lower() for pattern in test_tenant_patterns
        )
        
        if not is_test_tenant:
            logger.warning(
                f"TEST_ACCOUNT_GUARD: Tenant '{tenant}' doesn't match test patterns. "
                f"Proceeding because testTenant=true was provided."
            )
    
    logger.debug("TEST_ACCOUNT_GUARD: Test account verified")


def check_all_guards(
    env: str,
    flow_name: str,
    variables: Dict[str, Any],
    tenant: Optional[str] = None,
    force_allow_prod: bool = False
) -> None:
    """
    Run all security guard checks.
    
    Args:
        env: Target environment
        flow_name: Name of the flow
        variables: Flow variables
        tenant: Tenant identifier
        force_allow_prod: Force allow production (dangerous)
    
    Raises:
        HTTPException: If any guard check fails
    """
    try:
        check_env_guard(env, flow_name, force_allow=force_allow_prod)
        check_test_account_guard(variables, tenant)
    except GuardError as e:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "Guard check failed",
                "message": str(e),
                "flow_name": flow_name,
                "environment": env
            }
        )


def validate_credentials_are_test_accounts(
    username: Optional[str] = None,
    tenant: Optional[str] = None
) -> bool:
    """
    Validate that provided credentials appear to be test accounts.
    
    This is a heuristic check - actual validation should be done
    against the identity provider.
    
    Args:
        username: Username to check
        tenant: Tenant to check
    
    Returns:
        True if credentials appear to be test accounts
    """
    test_indicators = ['test', 'qa', 'automation', 'demo', 'sandbox']
    
    if username:
        username_lower = username.lower()
        if any(ind in username_lower for ind in test_indicators):
            return True
        
        # Check for common test account patterns
        if username_lower.startswith('svc-') or username_lower.startswith('bot-'):
            return True
    
    if tenant:
        tenant_lower = tenant.lower()
        if any(ind in tenant_lower for ind in test_indicators):
            return True
    
    return False
