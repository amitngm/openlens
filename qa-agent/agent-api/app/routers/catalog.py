"""Service catalog and discovery endpoints."""

import logging
from fastapi import APIRouter, HTTPException, Request

from app.models.catalog import ServiceCatalog, DiscoveryResult

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("", response_model=ServiceCatalog)
async def get_catalog(request: Request):
    """
    Get the current service catalog.
    
    Returns discovered services, ingresses, endpoints, and configmaps
    in the configured namespace.
    """
    if not hasattr(request.app.state, 'discovery_service'):
        raise HTTPException(
            status_code=503,
            detail="Discovery service not initialized"
        )
    
    discovery = request.app.state.discovery_service
    
    if discovery.catalog is None:
        # Trigger initial discovery
        await discovery.discover()
    
    if discovery.catalog is None:
        raise HTTPException(
            status_code=503,
            detail="Service catalog not available"
        )
    
    return discovery.catalog


@router.post("/discover", response_model=DiscoveryResult)
async def trigger_discovery(request: Request, force: bool = False):
    """
    Trigger a service discovery refresh.
    
    Args:
        force: Force refresh even if recently discovered
    """
    if not hasattr(request.app.state, 'discovery_service'):
        raise HTTPException(
            status_code=503,
            detail="Discovery service not initialized"
        )
    
    discovery = request.app.state.discovery_service
    result = await discovery.discover(force=force)
    
    return result


@router.get("/services")
async def list_services(request: Request):
    """List all discovered services."""
    if not hasattr(request.app.state, 'discovery_service'):
        raise HTTPException(
            status_code=503,
            detail="Discovery service not initialized"
        )
    
    discovery = request.app.state.discovery_service
    
    if discovery.catalog is None:
        await discovery.discover()
    
    services = discovery.catalog.services if discovery.catalog else []
    
    return {
        "services": [
            {
                "name": s.name,
                "namespace": s.namespace,
                "health": s.health.value,
                "internal_url": s.internal_url,
                "ports": s.ports,
                "ready_replicas": s.ready_replicas,
                "total_replicas": s.total_replicas
            }
            for s in services
        ],
        "total": len(services)
    }


@router.get("/services/{service_name}")
async def get_service(request: Request, service_name: str):
    """Get details for a specific service."""
    if not hasattr(request.app.state, 'discovery_service'):
        raise HTTPException(
            status_code=503,
            detail="Discovery service not initialized"
        )
    
    discovery = request.app.state.discovery_service
    
    if discovery.catalog is None:
        await discovery.discover()
    
    if discovery.catalog:
        for service in discovery.catalog.services:
            if service.name == service_name:
                return service
    
    raise HTTPException(
        status_code=404,
        detail=f"Service not found: {service_name}"
    )


@router.get("/ingresses")
async def list_ingresses(request: Request):
    """List all discovered ingresses."""
    if not hasattr(request.app.state, 'discovery_service'):
        raise HTTPException(
            status_code=503,
            detail="Discovery service not initialized"
        )
    
    discovery = request.app.state.discovery_service
    
    if discovery.catalog is None:
        await discovery.discover()
    
    ingresses = discovery.catalog.ingresses if discovery.catalog else []
    
    return {
        "ingresses": [
            {
                "name": i.name,
                "namespace": i.namespace,
                "hosts": i.hosts,
                "tls": i.tls,
                "ingress_class": i.ingress_class
            }
            for i in ingresses
        ],
        "total": len(ingresses)
    }


@router.get("/configmaps")
async def list_configmaps(request: Request):
    """List all discovered configmaps (metadata only)."""
    if not hasattr(request.app.state, 'discovery_service'):
        raise HTTPException(
            status_code=503,
            detail="Discovery service not initialized"
        )
    
    discovery = request.app.state.discovery_service
    
    if discovery.catalog is None:
        await discovery.discover()
    
    configmaps = discovery.catalog.configmaps if discovery.catalog else []
    
    return {
        "configmaps": [
            {
                "name": c.name,
                "namespace": c.namespace,
                "keys": c.keys
            }
            for c in configmaps
        ],
        "total": len(configmaps)
    }


@router.get("/health/{service_name}")
async def check_service_health(request: Request, service_name: str):
    """Check health of a specific service."""
    if not hasattr(request.app.state, 'discovery_service'):
        raise HTTPException(
            status_code=503,
            detail="Discovery service not initialized"
        )
    
    discovery = request.app.state.discovery_service
    
    is_healthy = discovery.is_service_healthy(service_name)
    url = discovery.get_service_url(service_name)
    
    return {
        "service": service_name,
        "healthy": is_healthy,
        "internal_url": url
    }
