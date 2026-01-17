"""
QA Agent API - Main FastAPI Application

This service orchestrates QA test flows for cloud products,
performing UI and API testing within a Kubernetes namespace.
"""

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.routers import runs, catalog, artifacts, health
from app.services.discovery import DiscoveryService
from app.services.rate_limiter import RateLimiter
from app.utils.logging import setup_logging, RedactingFilter
from app.utils.config import settings

# Setup logging with secret redaction
setup_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    logger.info("Starting QA Agent API...")
    
    # Initialize services
    app.state.discovery_service = DiscoveryService()
    app.state.rate_limiter = RateLimiter(
        max_concurrent=settings.MAX_CONCURRENT_RUNS,
        max_per_flow=settings.MAX_RUNS_PER_FLOW
    )
    
    # Initial discovery on startup
    if settings.AUTO_DISCOVER_ON_STARTUP:
        try:
            await app.state.discovery_service.discover()
            logger.info("Initial service discovery completed")
        except Exception as e:
            logger.warning(f"Initial discovery failed: {e}")
    
    yield
    
    # Cleanup
    logger.info("Shutting down QA Agent API...")


app = FastAPI(
    title="QA Agent API",
    description="Kubernetes-deployable QA Agent for automated UI and API testing",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.ENABLE_DOCS else None,
    redoc_url="/redoc" if settings.ENABLE_DOCS else None,
)

# CORS - restricted for internal use only
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """Add security headers to all responses."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Global exception handler with secret redaction."""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "error_id": str(id(exc))}
    )


# Include routers
app.include_router(health.router, tags=["Health"])
app.include_router(runs.router, prefix="/runs", tags=["Test Runs"])
app.include_router(catalog.router, prefix="/catalog", tags=["Service Catalog"])
app.include_router(artifacts.router, prefix="/artifacts", tags=["Artifacts"])


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "service": "QA Agent API",
        "version": "1.0.0",
        "status": "operational",
        "docs": "/docs" if settings.ENABLE_DOCS else "disabled"
    }
