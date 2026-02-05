"""Kubernetes service discovery for database services."""

import asyncio
import logging
from typing import List, Dict, Optional
from kubernetes import client, config
from kubernetes.client.rest import ApiException

logger = logging.getLogger(__name__)


class K8sDiscoveryService:
    """Discover database services in Kubernetes namespace."""

    DATABASE_INDICATORS = {
        "mongodb": ["mongo", "mongodb"],
        "postgresql": ["postgres", "postgresql", "pg"],
        "mysql": ["mysql", "mariadb"],
        "redis": ["redis"],
    }

    def __init__(self):
        self.k8s_loaded = False
        self.v1 = None

    async def _load_k8s_config(self) -> bool:
        """Load K8s config from kubeconfig or in-cluster."""
        if self.k8s_loaded:
            return True

        try:
            # Try to load in-cluster config first (if running in K8s pod)
            config.load_incluster_config()
            logger.info("Loaded in-cluster K8s configuration")
            self.k8s_loaded = True
        except config.ConfigException:
            try:
                # Fall back to kubeconfig file (local development)
                config.load_kube_config()
                logger.info("Loaded kubeconfig from file")
                self.k8s_loaded = True
            except Exception as e:
                logger.error(f"Failed to load K8s configuration: {e}")
                return False

        # Initialize API client
        self.v1 = client.CoreV1Api()
        return True

    def _detect_database_type(self, service_name: str, labels: Dict) -> Optional[str]:
        """
        Detect database type from service name and labels.

        Args:
            service_name: K8s service name
            labels: Service labels dictionary

        Returns:
            Database type (mongodb, postgresql, mysql, redis) or None
        """
        service_name_lower = service_name.lower()

        # Check all label values
        all_label_text = " ".join(str(v).lower() for v in labels.values()) if labels else ""
        search_text = f"{service_name_lower} {all_label_text}"

        # Match against indicators
        for db_type, indicators in self.DATABASE_INDICATORS.items():
            for indicator in indicators:
                if indicator in search_text:
                    return db_type

        return None

    async def discover_database_services(self, namespace: str = "default") -> List[Dict]:
        """
        Auto-discover database services in K8s namespace.

        Args:
            namespace: K8s namespace to search (default: "default")

        Returns:
            List of discovered database services with connection details
        """
        if not await self._load_k8s_config():
            logger.warning("K8s config not loaded, skipping database discovery")
            return []

        discovered_services = []

        try:
            # List all services in namespace
            logger.info(f"Discovering database services in namespace: {namespace}")
            services = self.v1.list_namespaced_service(namespace=namespace)

            for service in services.items:
                service_name = service.metadata.name
                labels = service.metadata.labels or {}

                # Detect if this is a database service
                db_type = self._detect_database_type(service_name, labels)
                if not db_type:
                    continue

                # Extract connection details
                ports = service.spec.ports or []
                port = None
                if ports:
                    # Use first port (usually main DB port)
                    port = ports[0].port

                # Internal cluster DNS name
                cluster_dns = f"{service_name}.{namespace}.svc.cluster.local"

                discovered_service = {
                    "service_name": service_name,
                    "namespace": namespace,
                    "db_type": db_type,
                    "host": cluster_dns,
                    "port": port,
                    "metadata": {
                        "labels": labels,
                        "cluster_ip": service.spec.cluster_ip,
                        "type": service.spec.type,
                        "selector": service.spec.selector or {},
                    }
                }

                discovered_services.append(discovered_service)
                logger.info(f"Discovered {db_type} service: {service_name} on port {port}")

        except ApiException as e:
            logger.error(f"K8s API error during service discovery: {e}")
        except Exception as e:
            logger.error(f"Unexpected error during K8s service discovery: {e}")

        logger.info(f"Total database services discovered: {len(discovered_services)}")
        return discovered_services

    async def get_service_info(self, service_name: str, namespace: str) -> Optional[Dict]:
        """
        Get detailed information about a specific service.

        Args:
            service_name: K8s service name
            namespace: K8s namespace

        Returns:
            Service details or None if not found
        """
        if not await self._load_k8s_config():
            return None

        try:
            service = self.v1.read_namespaced_service(name=service_name, namespace=namespace)

            labels = service.metadata.labels or {}
            db_type = self._detect_database_type(service_name, labels)

            ports = service.spec.ports or []
            port = ports[0].port if ports else None

            return {
                "service_name": service_name,
                "namespace": namespace,
                "db_type": db_type,
                "host": f"{service_name}.{namespace}.svc.cluster.local",
                "port": port,
                "metadata": {
                    "labels": labels,
                    "cluster_ip": service.spec.cluster_ip,
                    "type": service.spec.type,
                    "selector": service.spec.selector or {},
                    "creation_timestamp": service.metadata.creation_timestamp,
                }
            }

        except ApiException as e:
            if e.status == 404:
                logger.warning(f"Service {service_name} not found in namespace {namespace}")
            else:
                logger.error(f"K8s API error getting service info: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error getting service info: {e}")
            return None
