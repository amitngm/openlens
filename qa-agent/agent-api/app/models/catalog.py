"""Models for service discovery and catalog."""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class ServiceType(str, Enum):
    """Types of discovered services."""
    SERVICE = "service"
    INGRESS = "ingress"
    ENDPOINT = "endpoint"
    CONFIGMAP = "configmap"
    POD = "pod"


class ServiceHealth(str, Enum):
    """Health status of a service."""
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNHEALTHY = "unhealthy"
    UNKNOWN = "unknown"


class EndpointInfo(BaseModel):
    """Information about a service endpoint."""
    address: str = Field(..., description="Endpoint address")
    port: int = Field(..., description="Endpoint port")
    protocol: str = Field(default="TCP", description="Protocol")
    ready: bool = Field(default=True, description="Is endpoint ready")


class ServiceInfo(BaseModel):
    """Information about a discovered service."""
    name: str = Field(..., description="Service name")
    namespace: str = Field(..., description="Kubernetes namespace")
    service_type: ServiceType = Field(..., description="Type of resource")
    
    # Network info
    cluster_ip: Optional[str] = Field(None, description="ClusterIP address")
    external_ip: Optional[str] = Field(None, description="External IP if any")
    ports: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Exposed ports"
    )
    endpoints: List[EndpointInfo] = Field(
        default_factory=list,
        description="Active endpoints"
    )
    
    # Health
    health: ServiceHealth = Field(
        default=ServiceHealth.UNKNOWN,
        description="Health status"
    )
    ready_replicas: Optional[int] = Field(None, description="Ready replicas")
    total_replicas: Optional[int] = Field(None, description="Total replicas")
    
    # Metadata
    labels: Dict[str, str] = Field(
        default_factory=dict,
        description="Kubernetes labels"
    )
    annotations: Dict[str, str] = Field(
        default_factory=dict,
        description="Kubernetes annotations"
    )
    
    # URLs
    internal_url: Optional[str] = Field(None, description="Internal service URL")
    external_url: Optional[str] = Field(None, description="External URL if exposed")
    
    # Discovery metadata
    discovered_at: datetime = Field(
        default_factory=datetime.utcnow,
        description="Discovery timestamp"
    )


class IngressInfo(BaseModel):
    """Information about an Ingress resource."""
    name: str = Field(..., description="Ingress name")
    namespace: str = Field(..., description="Kubernetes namespace")
    hosts: List[str] = Field(default_factory=list, description="Configured hosts")
    paths: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Path rules"
    )
    tls: bool = Field(default=False, description="TLS enabled")
    ingress_class: Optional[str] = Field(None, description="Ingress class")
    load_balancer_ip: Optional[str] = Field(None, description="LB IP if assigned")


class ConfigMapInfo(BaseModel):
    """Information about a ConfigMap (metadata only, no data)."""
    name: str = Field(..., description="ConfigMap name")
    namespace: str = Field(..., description="Kubernetes namespace")
    keys: List[str] = Field(
        default_factory=list,
        description="Available keys (values not exposed)"
    )
    labels: Dict[str, str] = Field(default_factory=dict, description="Labels")


class ServiceCatalog(BaseModel):
    """Complete service catalog for a namespace."""
    namespace: str = Field(..., description="Discovered namespace")
    discovered_at: datetime = Field(
        default_factory=datetime.utcnow,
        description="Discovery timestamp"
    )
    
    services: List[ServiceInfo] = Field(
        default_factory=list,
        description="Discovered services"
    )
    ingresses: List[IngressInfo] = Field(
        default_factory=list,
        description="Discovered ingresses"
    )
    configmaps: List[ConfigMapInfo] = Field(
        default_factory=list,
        description="Discovered configmaps"
    )
    
    # Summary
    total_services: int = Field(default=0, description="Total services")
    healthy_services: int = Field(default=0, description="Healthy services")
    
    # Discovery metadata
    discovery_duration_ms: Optional[int] = Field(
        None,
        description="Discovery duration"
    )
    errors: List[str] = Field(
        default_factory=list,
        description="Discovery errors"
    )


class DiscoveryResult(BaseModel):
    """Result of a discovery operation."""
    success: bool = Field(..., description="Discovery successful")
    message: str = Field(..., description="Result message")
    catalog: Optional[ServiceCatalog] = Field(
        None,
        description="Discovered catalog"
    )
    duration_ms: int = Field(..., description="Discovery duration")
    timestamp: datetime = Field(
        default_factory=datetime.utcnow,
        description="Discovery timestamp"
    )
