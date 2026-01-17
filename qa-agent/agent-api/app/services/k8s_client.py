"""
Kubernetes client wrapper for the QA Agent.

Handles in-cluster and out-of-cluster authentication.
"""

import logging
from typing import Dict, List, Optional, Any
from functools import lru_cache

from kubernetes import client, config
from kubernetes.client.rest import ApiException

from app.utils.config import settings

logger = logging.getLogger(__name__)


class K8sClient:
    """Kubernetes API client wrapper."""
    
    _instance: Optional['K8sClient'] = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        
        self._load_config()
        self.core_v1 = client.CoreV1Api()
        self.apps_v1 = client.AppsV1Api()
        self.networking_v1 = client.NetworkingV1Api()
        self.batch_v1 = client.BatchV1Api()
        self._initialized = True
    
    def _load_config(self):
        """Load Kubernetes configuration."""
        try:
            if settings.IN_CLUSTER:
                config.load_incluster_config()
                logger.info("Loaded in-cluster Kubernetes config")
            else:
                config_file = settings.KUBECONFIG
                config.load_kube_config(config_file=config_file)
                logger.info(f"Loaded kubeconfig from {config_file or 'default'}")
        except Exception as e:
            logger.error(f"Failed to load Kubernetes config: {e}")
            raise
    
    def get_namespace(self) -> str:
        """Get the configured namespace."""
        return settings.NAMESPACE
    
    # Service operations
    def list_services(
        self,
        namespace: Optional[str] = None,
        label_selector: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """List services in a namespace."""
        ns = namespace or self.get_namespace()
        try:
            services = self.core_v1.list_namespaced_service(
                namespace=ns,
                label_selector=label_selector
            )
            return [self._service_to_dict(svc) for svc in services.items]
        except ApiException as e:
            logger.error(f"Failed to list services: {e}")
            return []
    
    def _service_to_dict(self, svc) -> Dict[str, Any]:
        """Convert Service object to dictionary."""
        spec = svc.spec
        return {
            "name": svc.metadata.name,
            "namespace": svc.metadata.namespace,
            "cluster_ip": spec.cluster_ip,
            "type": spec.type,
            "ports": [
                {
                    "name": p.name,
                    "port": p.port,
                    "target_port": str(p.target_port),
                    "protocol": p.protocol
                }
                for p in (spec.ports or [])
            ],
            "selector": spec.selector or {},
            "labels": svc.metadata.labels or {},
            "annotations": svc.metadata.annotations or {},
            "created_at": svc.metadata.creation_timestamp.isoformat()
                if svc.metadata.creation_timestamp else None
        }
    
    # Endpoint operations
    def list_endpoints(
        self,
        namespace: Optional[str] = None,
        label_selector: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """List endpoints in a namespace."""
        ns = namespace or self.get_namespace()
        try:
            endpoints = self.core_v1.list_namespaced_endpoints(
                namespace=ns,
                label_selector=label_selector
            )
            return [self._endpoint_to_dict(ep) for ep in endpoints.items]
        except ApiException as e:
            logger.error(f"Failed to list endpoints: {e}")
            return []
    
    def _endpoint_to_dict(self, ep) -> Dict[str, Any]:
        """Convert Endpoints object to dictionary."""
        addresses = []
        for subset in (ep.subsets or []):
            for addr in (subset.addresses or []):
                for port in (subset.ports or []):
                    addresses.append({
                        "ip": addr.ip,
                        "port": port.port,
                        "protocol": port.protocol,
                        "ready": True
                    })
            for addr in (subset.not_ready_addresses or []):
                for port in (subset.ports or []):
                    addresses.append({
                        "ip": addr.ip,
                        "port": port.port,
                        "protocol": port.protocol,
                        "ready": False
                    })
        
        return {
            "name": ep.metadata.name,
            "namespace": ep.metadata.namespace,
            "addresses": addresses,
            "labels": ep.metadata.labels or {}
        }
    
    # Ingress operations
    def list_ingresses(
        self,
        namespace: Optional[str] = None,
        label_selector: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """List ingresses in a namespace."""
        ns = namespace or self.get_namespace()
        try:
            ingresses = self.networking_v1.list_namespaced_ingress(
                namespace=ns,
                label_selector=label_selector
            )
            return [self._ingress_to_dict(ing) for ing in ingresses.items]
        except ApiException as e:
            logger.error(f"Failed to list ingresses: {e}")
            return []
    
    def _ingress_to_dict(self, ing) -> Dict[str, Any]:
        """Convert Ingress object to dictionary."""
        spec = ing.spec
        hosts = []
        paths = []
        
        for rule in (spec.rules or []):
            if rule.host:
                hosts.append(rule.host)
            if rule.http:
                for path in (rule.http.paths or []):
                    paths.append({
                        "path": path.path,
                        "path_type": path.path_type,
                        "backend_service": path.backend.service.name
                            if path.backend and path.backend.service else None,
                        "backend_port": path.backend.service.port.number
                            if path.backend and path.backend.service and path.backend.service.port else None
                    })
        
        return {
            "name": ing.metadata.name,
            "namespace": ing.metadata.namespace,
            "hosts": hosts,
            "paths": paths,
            "tls": bool(spec.tls),
            "ingress_class": spec.ingress_class_name,
            "labels": ing.metadata.labels or {},
            "annotations": ing.metadata.annotations or {}
        }
    
    # ConfigMap operations
    def list_configmaps(
        self,
        namespace: Optional[str] = None,
        label_selector: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """List configmaps in a namespace (metadata only, no data)."""
        ns = namespace or self.get_namespace()
        try:
            configmaps = self.core_v1.list_namespaced_config_map(
                namespace=ns,
                label_selector=label_selector
            )
            return [self._configmap_to_dict(cm) for cm in configmaps.items]
        except ApiException as e:
            logger.error(f"Failed to list configmaps: {e}")
            return []
    
    def _configmap_to_dict(self, cm) -> Dict[str, Any]:
        """Convert ConfigMap object to dictionary (no data, just keys)."""
        return {
            "name": cm.metadata.name,
            "namespace": cm.metadata.namespace,
            "keys": list((cm.data or {}).keys()),
            "labels": cm.metadata.labels or {}
        }
    
    # Pod operations
    def list_pods(
        self,
        namespace: Optional[str] = None,
        label_selector: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """List pods in a namespace."""
        ns = namespace or self.get_namespace()
        try:
            pods = self.core_v1.list_namespaced_pod(
                namespace=ns,
                label_selector=label_selector
            )
            return [self._pod_to_dict(pod) for pod in pods.items]
        except ApiException as e:
            logger.error(f"Failed to list pods: {e}")
            return []
    
    def _pod_to_dict(self, pod) -> Dict[str, Any]:
        """Convert Pod object to dictionary."""
        status = pod.status
        return {
            "name": pod.metadata.name,
            "namespace": pod.metadata.namespace,
            "phase": status.phase,
            "ready": all(
                c.ready for c in (status.container_statuses or [])
            ),
            "ip": status.pod_ip,
            "node": pod.spec.node_name,
            "containers": [c.name for c in pod.spec.containers],
            "labels": pod.metadata.labels or {}
        }
    
    def get_pod_logs(
        self,
        name: str,
        namespace: Optional[str] = None,
        container: Optional[str] = None,
        tail_lines: int = 100
    ) -> str:
        """Get logs from a pod."""
        ns = namespace or self.get_namespace()
        try:
            logs = self.core_v1.read_namespaced_pod_log(
                name=name,
                namespace=ns,
                container=container,
                tail_lines=tail_lines
            )
            return logs
        except ApiException as e:
            logger.error(f"Failed to get pod logs: {e}")
            return ""
    
    # Job operations
    def create_job(
        self,
        name: str,
        image: str,
        command: List[str],
        namespace: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        volumes: Optional[List[Dict]] = None,
        service_account: Optional[str] = None,
        labels: Optional[Dict[str, str]] = None,
        resources: Optional[Dict[str, Dict[str, str]]] = None
    ) -> Dict[str, Any]:
        """Create a Kubernetes Job."""
        ns = namespace or self.get_namespace()
        
        # Build environment variables
        env_vars = []
        if env:
            for k, v in env.items():
                env_vars.append(client.V1EnvVar(name=k, value=v))
        
        # Build resource requirements
        resource_reqs = None
        if resources:
            resource_reqs = client.V1ResourceRequirements(
                limits=resources.get('limits'),
                requests=resources.get('requests')
            )
        
        # Build container
        container = client.V1Container(
            name="runner",
            image=image,
            command=command,
            env=env_vars,
            resources=resource_reqs
        )
        
        # Build pod spec
        pod_spec = client.V1PodSpec(
            containers=[container],
            restart_policy="Never",
            service_account_name=service_account
        )
        
        # Build job spec
        job = client.V1Job(
            api_version="batch/v1",
            kind="Job",
            metadata=client.V1ObjectMeta(
                name=name,
                namespace=ns,
                labels=labels or {}
            ),
            spec=client.V1JobSpec(
                template=client.V1PodTemplateSpec(
                    metadata=client.V1ObjectMeta(labels=labels or {}),
                    spec=pod_spec
                ),
                backoff_limit=0,
                ttl_seconds_after_finished=3600  # Cleanup after 1 hour
            )
        )
        
        try:
            result = self.batch_v1.create_namespaced_job(namespace=ns, body=job)
            return {
                "name": result.metadata.name,
                "namespace": result.metadata.namespace,
                "uid": result.metadata.uid
            }
        except ApiException as e:
            logger.error(f"Failed to create job: {e}")
            raise
    
    def get_job_status(
        self,
        name: str,
        namespace: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get job status."""
        ns = namespace or self.get_namespace()
        try:
            job = self.batch_v1.read_namespaced_job(name=name, namespace=ns)
            status = job.status
            return {
                "name": job.metadata.name,
                "active": status.active or 0,
                "succeeded": status.succeeded or 0,
                "failed": status.failed or 0,
                "start_time": status.start_time.isoformat() if status.start_time else None,
                "completion_time": status.completion_time.isoformat()
                    if status.completion_time else None
            }
        except ApiException as e:
            logger.error(f"Failed to get job status: {e}")
            return {}
    
    def delete_job(
        self,
        name: str,
        namespace: Optional[str] = None
    ) -> bool:
        """Delete a job."""
        ns = namespace or self.get_namespace()
        try:
            self.batch_v1.delete_namespaced_job(
                name=name,
                namespace=ns,
                propagation_policy="Background"
            )
            return True
        except ApiException as e:
            logger.error(f"Failed to delete job: {e}")
            return False


@lru_cache()
def get_k8s_client() -> K8sClient:
    """Get singleton K8s client instance."""
    return K8sClient()
