"""Health check endpoints."""

import logging
from datetime import datetime
from fastapi import APIRouter, Request

from app.utils.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/health")
async def health_check():
    """Basic health check."""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "service": "qa-agent-api",
        "version": "1.0.0"
    }


@router.get("/health/ready")
async def readiness_check(request: Request):
    """Kubernetes readiness probe."""
    checks = {
        "api": True,
        "discovery": False,
        "rate_limiter": False
    }
    
    try:
        # Check discovery service
        if hasattr(request.app.state, 'discovery_service'):
            checks["discovery"] = True
        
        # Check rate limiter
        if hasattr(request.app.state, 'rate_limiter'):
            checks["rate_limiter"] = True
    except Exception as e:
        logger.error(f"Readiness check failed: {e}")
    
    all_ready = all(checks.values())
    
    return {
        "ready": all_ready,
        "checks": checks,
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }


@router.get("/health/live")
async def liveness_check():
    """Kubernetes liveness probe."""
    return {
        "alive": True,
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }


@router.get("/health/config")
async def config_check():
    """Show non-sensitive configuration."""
    return {
        "environment": settings.ENVIRONMENT,
        "namespace": settings.NAMESPACE,
        "max_concurrent_runs": settings.MAX_CONCURRENT_RUNS,
        "max_runs_per_flow": settings.MAX_RUNS_PER_FLOW,
        "env_guard_enabled": settings.ENV_GUARD_ENABLED,
        "test_account_guard_enabled": settings.TEST_ACCOUNT_GUARD_ENABLED,
        "runner_timeout_seconds": settings.RUNNER_TIMEOUT_SECONDS,
        "artifacts_retention_days": settings.ARTIFACTS_RETENTION_DAYS
    }
