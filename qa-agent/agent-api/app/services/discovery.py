"""
Service discovery for the QA Agent.

Discovers services, ingresses, endpoints, and configmaps in the namespace.
"""

import logging
import time
from datetime import datetime
from typing import Optional

from app.models.catalog import (
    ServiceCatalog,
    ServiceInfo,
    ServiceType,
    ServiceHealth,
    IngressInfo,
    ConfigMapInfo,
    EndpointInfo,
    DiscoveryResult,
)
from app.services.k8s_client import get_k8s_client
from app.utils.config import settings

logger = logging.getLogger(__name__)


class DiscoveryService:
    """Service discovery manager."""
    
    def __init__(self):
        self._catalog: Optional[ServiceCatalog] = None
        self._last_discovery: Optional[datetime] = None
    
    @property
    def catalog(self) -> Optional[ServiceCatalog]:
        """Get current service catalog."""
        return self._catalog
    
    @property
    def last_discovery(self) -> Optional[datetime]:
        """Get last discovery timestamp."""
        return self._last_discovery
    
    async def discover(self, force: bool = False) -> DiscoveryResult:
        """
        Perform service discovery.
        
        Args:
            force: Force refresh even if recently discovered
        
        Returns:
            DiscoveryResult with discovered catalog
        """
        start_time = time.time()
        errors = []
        
        logger.info(f"Starting service discovery in namespace '{settings.NAMESPACE}'")
        
        try:
            k8s = get_k8s_client()
            namespace = settings.NAMESPACE
            discovery_rules = settings.DISCOVERY_RULES.split(',')
            
            services = []
            ingresses = []
            configmaps = []
            
            # Discover services
            if 'services' in discovery_rules:
                try:
                    raw_services = k8s.list_services(namespace=namespace)
                    services = self._process_services(raw_services, k8s, namespace)
                    logger.info(f"Discovered {len(services)} services")
                except Exception as e:
                    errors.append(f"Services discovery failed: {e}")
                    logger.error(f"Services discovery failed: {e}")
            
            # Discover ingresses
            if 'ingress' in discovery_rules:
                try:
                    raw_ingresses = k8s.list_ingresses(namespace=namespace)
                    ingresses = self._process_ingresses(raw_ingresses)
                    logger.info(f"Discovered {len(ingresses)} ingresses")
                except Exception as e:
                    errors.append(f"Ingress discovery failed: {e}")
                    logger.error(f"Ingress discovery failed: {e}")
            
            # Discover configmaps
            if 'configmaps' in discovery_rules:
                try:
                    raw_configmaps = k8s.list_configmaps(namespace=namespace)
                    configmaps = self._process_configmaps(raw_configmaps)
                    logger.info(f"Discovered {len(configmaps)} configmaps")
                except Exception as e:
                    errors.append(f"ConfigMap discovery failed: {e}")
                    logger.error(f"ConfigMap discovery failed: {e}")
            
            # Calculate health summary
            healthy_count = sum(
                1 for s in services if s.health == ServiceHealth.HEALTHY
            )
            
            duration_ms = int((time.time() - start_time) * 1000)
            
            self._catalog = ServiceCatalog(
                namespace=namespace,
                discovered_at=datetime.utcnow(),
                services=services,
                ingresses=ingresses,
                configmaps=configmaps,
                total_services=len(services),
                healthy_services=healthy_count,
                discovery_duration_ms=duration_ms,
                errors=errors
            )
            
            self._last_discovery = datetime.utcnow()
            
            logger.info(
                f"Discovery completed: {len(services)} services, "
                f"{len(ingresses)} ingresses, {len(configmaps)} configmaps "
                f"in {duration_ms}ms"
            )
            
            return DiscoveryResult(
                success=len(errors) == 0,
                message="Discovery completed" + (
                    f" with {len(errors)} errors" if errors else ""
                ),
                catalog=self._catalog,
                duration_ms=duration_ms,
                timestamp=datetime.utcnow()
            )
            
        except Exception as e:
            duration_ms = int((time.time() - start_time) * 1000)
            logger.error(f"Discovery failed: {e}")
            return DiscoveryResult(
                success=False,
                message=f"Discovery failed: {e}",
                catalog=None,
                duration_ms=duration_ms,
                timestamp=datetime.utcnow()
            )
    
    def _process_services(
        self,
        raw_services: list,
        k8s,
        namespace: str
    ) -> list:
        """Process raw service data into ServiceInfo objects."""
        services = []
        
        # Get endpoints for health checking
        raw_endpoints = k8s.list_endpoints(namespace=namespace)
        endpoints_map = {ep['name']: ep for ep in raw_endpoints}
        
        for svc in raw_services:
            # Determine health based on endpoints
            ep_data = endpoints_map.get(svc['name'], {})
            addresses = ep_data.get('addresses', [])
            ready_count = sum(1 for a in addresses if a.get('ready', False))
            
            if ready_count > 0:
                health = ServiceHealth.HEALTHY
            elif addresses:
                health = ServiceHealth.DEGRADED
            else:
                health = ServiceHealth.UNHEALTHY
            
            # Build endpoints list
            endpoints = [
                EndpointInfo(
                    address=a['ip'],
                    port=a['port'],
                    protocol=a.get('protocol', 'TCP'),
                    ready=a.get('ready', False)
                )
                for a in addresses
            ]
            
            # Build internal URL
            ports = svc.get('ports', [])
            primary_port = ports[0]['port'] if ports else None
            internal_url = (
                f"http://{svc['name']}.{namespace}.svc.cluster.local"
                + (f":{primary_port}" if primary_port and primary_port != 80 else "")
            )
            
            services.append(ServiceInfo(
                name=svc['name'],
                namespace=svc['namespace'],
                service_type=ServiceType.SERVICE,
                cluster_ip=svc.get('cluster_ip'),
                ports=svc.get('ports', []),
                endpoints=endpoints,
                health=health,
                ready_replicas=ready_count,
                total_replicas=len(addresses),
                labels=svc.get('labels', {}),
                annotations=svc.get('annotations', {}),
                internal_url=internal_url,
                discovered_at=datetime.utcnow()
            ))
        
        return services
    
    def _process_ingresses(self, raw_ingresses: list) -> list:
        """Process raw ingress data into IngressInfo objects."""
        ingresses = []
        
        for ing in raw_ingresses:
            ingresses.append(IngressInfo(
                name=ing['name'],
                namespace=ing['namespace'],
                hosts=ing.get('hosts', []),
                paths=ing.get('paths', []),
                tls=ing.get('tls', False),
                ingress_class=ing.get('ingress_class')
            ))
        
        return ingresses
    
    def _process_configmaps(self, raw_configmaps: list) -> list:
        """Process raw configmap data into ConfigMapInfo objects."""
        configmaps = []
        
        for cm in raw_configmaps:
            configmaps.append(ConfigMapInfo(
                name=cm['name'],
                namespace=cm['namespace'],
                keys=cm.get('keys', []),
                labels=cm.get('labels', {})
            ))
        
        return configmaps
    
    def get_service_url(self, service_name: str) -> Optional[str]:
        """Get internal URL for a service."""
        if not self._catalog:
            return None
        
        for svc in self._catalog.services:
            if svc.name == service_name:
                return svc.internal_url
        
        return None
    
    def is_service_healthy(self, service_name: str) -> bool:
        """Check if a service is healthy."""
        if not self._catalog:
            return False
        
        for svc in self._catalog.services:
            if svc.name == service_name:
                return svc.health == ServiceHealth.HEALTHY
        
        return False
