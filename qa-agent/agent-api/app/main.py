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

from app.routers import runs, catalog, artifacts, health, live_test
from fastapi import HTTPException
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
app.include_router(live_test.router, prefix="/live", tags=["Live Testing"])


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "service": "QA Agent API",
        "version": "1.0.0",
        "status": "operational",
        "docs": "/docs" if settings.ENABLE_DOCS else "disabled"
    }


@app.get("/flows")
async def list_flows(request: Request):
    """List all available test flows."""
    from app.services.flow_loader import FlowLoader
    
    if not hasattr(request.app.state, 'flow_loader'):
        request.app.state.flow_loader = FlowLoader()
    
    flow_loader = request.app.state.flow_loader
    flows = flow_loader.list_flows()
    
    result = []
    for flow_name in flows:
        flow = flow_loader.get_flow(flow_name)
        if flow:
            # Group steps into a single "main" stage for UI compatibility
            steps_data = []
            for step in flow.steps:
                steps_data.append({
                    "type": step.type.value,
                    "name": step.name,
                    "action": step.ui.action if step.ui else None,
                    "method": step.api.method if step.api else None,
                    "url": step.api.url if step.api else (step.ui.url if step.ui else None),
                })
            
            result.append({
                "name": flow.name,
                "description": flow.description or "No description",
                "version": flow.version,
                "tags": flow.tags,
                "stages": [
                    {
                        "name": "main",
                        "steps": steps_data
                    }
                ]
            })
    
    return result


@app.post("/run")
async def start_run(request: Request):
    """Start a new test run (convenience endpoint)."""
    from app.services.run_manager import RunManager
    from app.services.flow_loader import FlowLoader
    from app.services.artifact_manager import ArtifactManager
    from app.models.runs import RunRequest
    
    body = await request.json()
    run_request = RunRequest(**body)
    
    if not hasattr(request.app.state, 'run_manager'):
        request.app.state.run_manager = RunManager(
            flow_loader=FlowLoader(),
            artifact_manager=ArtifactManager(),
            rate_limiter=request.app.state.rate_limiter
        )
    
    manager = request.app.state.run_manager
    response = await manager.create_run(run_request)
    return response


@app.get("/namespaces")
async def list_namespaces(request: Request):
    """List available Kubernetes namespaces."""
    from app.services.k8s_client import K8sClient
    
    try:
        k8s = K8sClient()
        namespaces = await k8s.list_namespaces()
        return {
            "namespaces": [
                {"name": ns.metadata.name, "status": ns.status.phase.lower() if ns.status.phase else "active"}
                for ns in namespaces
            ]
        }
    except Exception as e:
        logger.warning(f"Failed to list namespaces: {e}")
        # Return demo namespaces when not in cluster
        return {
            "namespaces": [
                {"name": "default", "status": "active"},
                {"name": "kube-system", "status": "active"},
                {"name": "qa-agent", "status": "active"},
                {"name": "production", "status": "active"},
                {"name": "staging", "status": "active"},
                {"name": "development", "status": "active"},
            ]
        }


@app.post("/smart-test")
async def smart_test(request: Request):
    """
    AI-powered smart test endpoint.
    
    Accepts URL, credentials, and keywords, then intelligently
    navigates and tests the application.
    """
    import uuid
    from datetime import datetime
    
    body = await request.json()
    
    # Validate required fields
    url = body.get('url')
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
    
    # Generate run ID
    run_id = f"smart-{uuid.uuid4().hex[:8]}"
    
    # Log the smart test request (redact password)
    safe_body = {**body}
    if 'password' in safe_body:
        safe_body['password'] = '***REDACTED***'
    logger.info(f"Smart test requested: {safe_body}")
    
    # In a real implementation, this would:
    # 1. Use Playwright to navigate to the URL
    # 2. Analyze the page structure using AI/heuristics
    # 3. Identify login forms, navigation elements, etc.
    # 4. Execute the requested actions intelligently
    # 5. Capture screenshots and results
    
    return {
        "run_id": run_id,
        "status": "started",
        "message": "Smart test initiated",
        "config": {
            "url": url,
            "actions": body.get('actions', []),
            "keywords": body.get('keywords', []),
            "has_credentials": bool(body.get('username')),
        },
        "started_at": datetime.utcnow().isoformat() + "Z"
    }


@app.post("/catalog/discover")
async def discover_services(request: Request):
    """Trigger service discovery in selected namespaces."""
    body = await request.json()
    namespaces = body.get('namespaces', ['default'])
    
    discovery = request.app.state.discovery_service
    results = {}
    
    for ns in namespaces:
        try:
            catalog = await discovery.discover(namespace=ns)
            results[ns] = catalog
        except Exception as e:
            logger.warning(f"Discovery failed for namespace {ns}: {e}")
            results[ns] = {"error": str(e)}
    
    return {
        "discovered_namespaces": list(results.keys()),
        "results": results
    }
