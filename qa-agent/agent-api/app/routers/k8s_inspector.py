"""
Kubernetes Inspector - Read-only access to K8s resources for debugging

Endpoints:
- GET /k8s/namespaces - List accessible namespaces
- POST /k8s/allowlist - Set allowed namespaces (server-side storage)
- GET /k8s/allowlist - Get current allowlist
- GET /k8s/pods/{namespace} - List pods in namespace
- GET /k8s/pods/{namespace}/{pod}/logs - Get pod logs (last 200 lines)
- GET /k8s/pods/{namespace}/{pod}/status - Get pod status and events
"""

import os
import json
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from kubernetes import client, config
from kubernetes.client.rest import ApiException

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/k8s", tags=["Kubernetes Inspector"])

# Configuration
ALLOWLIST_FILE = Path(os.getenv("ALLOWLIST_FILE", "/data/namespace_allowlist.json"))
IN_CLUSTER = os.getenv("IN_CLUSTER", "false").lower() == "true"
ENABLE_LOGS = os.getenv("ENABLE_K8S_LOGS", "true").lower() == "true"

# Initialize K8s client
try:
    if IN_CLUSTER:
        config.load_incluster_config()
    else:
        try:
            config.load_kube_config()
        except:
            logger.warning("Kubeconfig not found, K8s features disabled")
            IN_CLUSTER = False
except Exception as e:
    logger.warning(f"Failed to load K8s config: {e}")
    IN_CLUSTER = False

# K8s API clients
v1_core = None
v1_apps = None
if IN_CLUSTER:
    try:
        v1_core = client.CoreV1Api()
        v1_apps = client.AppsV1Api()
    except Exception as e:
        logger.error(f"Failed to initialize K8s clients: {e}")


def load_allowlist() -> List[str]:
    """Load namespace allowlist from file."""
    if ALLOWLIST_FILE.exists():
        try:
            with open(ALLOWLIST_FILE) as f:
                data = json.load(f)
                return data.get("namespaces", [])
        except Exception as e:
            logger.error(f"Failed to load allowlist: {e}")
    return []


def save_allowlist(namespaces: List[str]):
    """Save namespace allowlist to file."""
    ALLOWLIST_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(ALLOWLIST_FILE, "w") as f:
        json.dump({
            "namespaces": namespaces,
            "updated_at": datetime.utcnow().isoformat() + "Z"
        }, f, indent=2)


def check_namespace_allowed(namespace: str) -> bool:
    """Check if namespace is in allowlist."""
    allowlist = load_allowlist()
    return len(allowlist) == 0 or namespace in allowlist  # Empty allowlist = all allowed


@router.get("/namespaces")
async def list_namespaces():
    """List all namespaces visible to ServiceAccount."""
    if not IN_CLUSTER or not v1_core:
        return {"namespaces": [], "error": "K8s client not available"}
    
    try:
        namespaces = v1_core.list_namespace()
        namespace_list = [
            {
                "name": ns.metadata.name,
                "status": ns.status.phase,
                "created": ns.metadata.creation_timestamp.isoformat() if ns.metadata.creation_timestamp else None
            }
            for ns in namespaces.items
        ]
        
        allowlist = load_allowlist()
        
        return {
            "namespaces": namespace_list,
            "allowlist": allowlist,
            "total": len(namespace_list)
        }
    except ApiException as e:
        logger.error(f"K8s API error: {e}")
        raise HTTPException(500, f"Failed to list namespaces: {e.reason}")
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        raise HTTPException(500, f"Unexpected error: {str(e)}")


@router.post("/allowlist")
async def set_allowlist(namespaces: List[str]):
    """Set namespace allowlist (server-side storage)."""
    # Validate namespaces exist
    if IN_CLUSTER and v1_core:
        try:
            existing = {ns.metadata.name for ns in v1_core.list_namespace().items}
            invalid = [ns for ns in namespaces if ns not in existing]
            if invalid:
                raise HTTPException(400, f"Namespaces not found: {invalid}")
        except Exception as e:
            logger.warning(f"Could not validate namespaces: {e}")
    
    save_allowlist(namespaces)
    return {
        "allowlist": namespaces,
        "message": f"Allowlist updated: {len(namespaces)} namespaces"
    }


@router.get("/allowlist")
async def get_allowlist():
    """Get current namespace allowlist."""
    return {
        "allowlist": load_allowlist(),
        "total": len(load_allowlist())
    }


@router.get("/pods/{namespace}")
async def list_pods(namespace: str):
    """List pods in a namespace (only if allowed)."""
    if not check_namespace_allowed(namespace):
        raise HTTPException(403, f"Namespace '{namespace}' not in allowlist")
    
    if not IN_CLUSTER or not v1_core:
        raise HTTPException(503, "K8s client not available")
    
    try:
        pods = v1_core.list_namespaced_pod(namespace)
        pod_list = [
            {
                "name": pod.metadata.name,
                "namespace": pod.metadata.namespace,
                "status": pod.status.phase,
                "ready": f"{sum(1 for c in pod.status.container_statuses or [] if c.ready)}/{len(pod.status.container_statuses or [])}",
                "restarts": sum(c.restart_count for c in pod.status.container_statuses or []),
                "created": pod.metadata.creation_timestamp.isoformat() if pod.metadata.creation_timestamp else None,
                "containers": [c.name for c in pod.spec.containers]
            }
            for pod in pods.items
        ]
        
        return {
            "namespace": namespace,
            "pods": pod_list,
            "total": len(pod_list)
        }
    except ApiException as e:
        if e.status == 403:
            raise HTTPException(403, "Access denied to namespace")
        raise HTTPException(500, f"Failed to list pods: {e.reason}")


@router.get("/pods/{namespace}/{pod_name}/status")
async def get_pod_status(namespace: str, pod_name: str):
    """Get pod status, events, and restart info."""
    if not check_namespace_allowed(namespace):
        raise HTTPException(403, f"Namespace '{namespace}' not in allowlist")
    
    if not IN_CLUSTER or not v1_core:
        raise HTTPException(503, "K8s client not available")
    
    try:
        pod = v1_core.read_namespaced_pod(pod_name, namespace)
        
        # Get events
        events = v1_core.list_namespaced_event(
            namespace,
            field_selector=f"involvedObject.name={pod_name}"
        )
        
        status = {
            "name": pod.metadata.name,
            "namespace": pod.metadata.namespace,
            "status": pod.status.phase,
            "ready": sum(1 for c in pod.status.container_statuses or [] if c.ready),
            "total_containers": len(pod.status.container_statuses or []),
            "restarts": sum(c.restart_count for c in pod.status.container_statuses or []),
            "created": pod.metadata.creation_timestamp.isoformat() if pod.metadata.creation_timestamp else None,
            "conditions": [
                {
                    "type": c.type,
                    "status": c.status,
                    "reason": c.reason,
                    "message": c.message
                }
                for c in pod.status.conditions or []
            ],
            "container_statuses": [
                {
                    "name": c.name,
                    "ready": c.ready,
                    "restart_count": c.restart_count,
                    "state": {
                        "running": c.state.running.started_at.isoformat() if c.state.running else None,
                        "waiting": {
                            "reason": c.state.waiting.reason if c.state.waiting else None,
                            "message": c.state.waiting.message if c.state.waiting else None
                        } if c.state.waiting else None,
                        "terminated": {
                            "reason": c.state.terminated.reason if c.state.terminated else None,
                            "exit_code": c.state.terminated.exit_code if c.state.terminated else None,
                            "finished_at": c.state.terminated.finished_at.isoformat() if c.state.terminated and c.state.terminated.finished_at else None
                        } if c.state.terminated else None
                    }
                }
                for c in pod.status.container_statuses or []
            ],
            "events": [
                {
                    "type": e.type,
                    "reason": e.reason,
                    "message": e.message,
                    "count": e.count,
                    "first_timestamp": e.first_timestamp.isoformat() if e.first_timestamp else None,
                    "last_timestamp": e.last_timestamp.isoformat() if e.last_timestamp else None
                }
                for e in events.items[:20]  # Last 20 events
            ]
        }
        
        return status
        
    except ApiException as e:
        if e.status == 404:
            raise HTTPException(404, f"Pod '{pod_name}' not found in namespace '{namespace}'")
        if e.status == 403:
            raise HTTPException(403, "Access denied")
        raise HTTPException(500, f"Failed to get pod status: {e.reason}")


@router.get("/pods/{namespace}/{pod_name}/logs")
async def get_pod_logs(
    namespace: str,
    pod_name: str,
    container: Optional[str] = Query(None, description="Container name (optional)"),
    lines: int = Query(200, description="Number of log lines")
):
    """Get pod logs (last N lines). Only if ENABLE_K8S_LOGS=true."""
    if not ENABLE_LOGS:
        raise HTTPException(403, "K8s logs are disabled (ENABLE_K8S_LOGS=false)")
    
    if not check_namespace_allowed(namespace):
        raise HTTPException(403, f"Namespace '{namespace}' not in allowlist")
    
    if not IN_CLUSTER or not v1_core:
        raise HTTPException(503, "K8s client not available")
    
    try:
        # Get pod to find container name if not specified
        if not container:
            pod = v1_core.read_namespaced_pod(pod_name, namespace)
            if not pod.spec.containers:
                raise HTTPException(400, "Pod has no containers")
            container = pod.spec.containers[0].name
        
        logs = v1_core.read_namespaced_pod_log(
            pod_name,
            namespace,
            container=container,
            tail_lines=lines
        )
        
        return {
            "namespace": namespace,
            "pod": pod_name,
            "container": container,
            "lines": len(logs.splitlines()),
            "logs": logs
        }
        
    except ApiException as e:
        if e.status == 404:
            raise HTTPException(404, f"Pod '{pod_name}' or container '{container}' not found")
        if e.status == 403:
            raise HTTPException(403, "Access denied to pod logs")
        raise HTTPException(500, f"Failed to get logs: {e.reason}")
