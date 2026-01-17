"""
Live Testing API - Real browser automation and discovery.
"""

import logging
import asyncio
import uuid
from datetime import datetime
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter()


class ConnectRequest(BaseModel):
    url: str
    username: Optional[str] = None
    password: Optional[str] = None
    namespaces: List[str] = ["default"]


class DiscoveryResult(BaseModel):
    url: str
    connected: bool
    logged_in: bool
    screenshot: Optional[str] = None
    page_title: Optional[str] = None
    ui_elements: Dict[str, int] = {}
    detected_elements: List[Dict[str, Any]] = []
    api_endpoints: List[str] = []
    k8s_pods: List[Dict[str, Any]] = []
    k8s_services: List[Dict[str, Any]] = []
    error: Optional[str] = None


# Store active sessions
_sessions: Dict[str, Dict[str, Any]] = {}


@router.post("/connect")
async def connect_to_app(request: Request, body: ConnectRequest):
    """
    Connect to an application URL and optionally login.
    Returns real page information.
    """
    session_id = str(uuid.uuid4())[:8]
    
    result = DiscoveryResult(
        url=body.url,
        connected=False,
        logged_in=False
    )
    
    try:
        # Try to actually fetch the URL to verify it's reachable
        import httpx
        
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, verify=False) as client:
            response = await client.get(body.url)
            result.connected = response.status_code < 500
            
            # Parse basic page info
            html = response.text
            
            # Extract title
            import re
            title_match = re.search(r'<title[^>]*>([^<]+)</title>', html, re.IGNORECASE)
            if title_match:
                result.page_title = title_match.group(1).strip()
            
            # Count UI elements (basic HTML parsing)
            result.ui_elements = {
                "forms": len(re.findall(r'<form', html, re.IGNORECASE)),
                "buttons": len(re.findall(r'<button', html, re.IGNORECASE)) + len(re.findall(r'type=["\']submit["\']', html, re.IGNORECASE)),
                "inputs": len(re.findall(r'<input', html, re.IGNORECASE)),
                "links": len(re.findall(r'<a\s+[^>]*href', html, re.IGNORECASE)),
                "tables": len(re.findall(r'<table', html, re.IGNORECASE)),
                "images": len(re.findall(r'<img', html, re.IGNORECASE)),
            }
            
            # Detect common elements
            detected = []
            
            # Find login form
            if re.search(r'type=["\']password["\']', html, re.IGNORECASE):
                detected.append({
                    "type": "login_form",
                    "label": "Login Form Detected",
                    "confidence": "high"
                })
            
            # Find navigation
            if re.search(r'<nav|class=["\'][^"\']*nav', html, re.IGNORECASE):
                detected.append({
                    "type": "navigation",
                    "label": "Navigation Menu",
                    "confidence": "high"
                })
            
            # Find search
            if re.search(r'type=["\']search["\']|placeholder=["\'][^"\']*search', html, re.IGNORECASE):
                detected.append({
                    "type": "search",
                    "label": "Search Input",
                    "confidence": "medium"
                })
            
            # Find data tables
            if re.search(r'<table|class=["\'][^"\']*table|data-table', html, re.IGNORECASE):
                detected.append({
                    "type": "data_table",
                    "label": "Data Table",
                    "confidence": "medium"
                })
            
            # Find modals/dialogs
            if re.search(r'class=["\'][^"\']*modal|role=["\']dialog["\']', html, re.IGNORECASE):
                detected.append({
                    "type": "modal",
                    "label": "Modal/Dialog",
                    "confidence": "medium"
                })
            
            result.detected_elements = detected
            
            # Try to find API endpoints from the HTML/JS
            api_patterns = re.findall(r'["\']/(api|v1|v2)/[a-zA-Z0-9/_-]+["\']', html)
            result.api_endpoints = list(set([p.strip('"\'') for p in api_patterns]))[:10]
            
    except httpx.ConnectError as e:
        result.error = f"Cannot connect to {body.url}: Connection refused"
        logger.error(f"Connection error: {e}")
    except httpx.TimeoutException:
        result.error = f"Timeout connecting to {body.url}"
    except Exception as e:
        result.error = f"Error: {str(e)}"
        logger.error(f"Error connecting: {e}", exc_info=True)
    
    # Get real Kubernetes resources
    try:
        from app.services.k8s_client import K8sClient
        k8s = K8sClient()
        
        for ns in body.namespaces:
            try:
                # Get pods
                pods = k8s.list_pods(namespace=ns)
                for pod in pods:
                    result.k8s_pods.append({
                        "name": pod["name"],
                        "namespace": ns,
                        "status": pod.get("phase", "Unknown"),
                        "ready": pod.get("ready", False),
                        "ip": pod.get("ip"),
                    })
                
                # Get services
                services = k8s.list_services(namespace=ns)
                for svc in services:
                    result.k8s_services.append({
                        "name": svc["name"],
                        "namespace": ns,
                        "type": svc.get("type", "ClusterIP"),
                        "cluster_ip": svc.get("cluster_ip"),
                        "ports": svc.get("ports", []),
                    })
            except Exception as e:
                logger.warning(f"Failed to get K8s resources from {ns}: {e}")
                
    except Exception as e:
        logger.warning(f"K8s client not available: {e}")
        # Add note that K8s is not available
        result.k8s_pods = []
        result.k8s_services = []
    
    # Store session
    _sessions[session_id] = {
        "url": body.url,
        "result": result,
        "created_at": datetime.utcnow().isoformat()
    }
    
    return {
        "session_id": session_id,
        "result": result
    }


@router.post("/login")
async def perform_login(request: Request, session_id: str, username: str, password: str):
    """
    Attempt to login to the connected application.
    """
    if session_id not in _sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = _sessions[session_id]
    url = session["url"]
    
    # For real login, we would need Playwright
    # This is a simplified version using httpx
    try:
        import httpx
        
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, verify=False) as client:
            # First get the login page to find the form
            response = await client.get(url)
            
            # Try common login endpoints
            login_endpoints = [
                f"{url}/api/auth/login",
                f"{url}/api/login",
                f"{url}/login",
                f"{url}/api/v1/auth/login",
                f"{url}/auth/login",
            ]
            
            login_success = False
            login_response = None
            
            for endpoint in login_endpoints:
                try:
                    # Try JSON login
                    resp = await client.post(
                        endpoint,
                        json={"username": username, "password": password},
                        headers={"Content-Type": "application/json"}
                    )
                    if resp.status_code in [200, 201, 302]:
                        login_success = True
                        login_response = resp
                        break
                        
                    # Try form login
                    resp = await client.post(
                        endpoint,
                        data={"username": username, "password": password}
                    )
                    if resp.status_code in [200, 201, 302]:
                        login_success = True
                        login_response = resp
                        break
                except:
                    continue
            
            return {
                "session_id": session_id,
                "logged_in": login_success,
                "status_code": login_response.status_code if login_response else None,
                "message": "Login successful" if login_success else "Login failed - could not find valid login endpoint"
            }
            
    except Exception as e:
        return {
            "session_id": session_id,
            "logged_in": False,
            "error": str(e)
        }


@router.get("/k8s/pods")
async def get_real_pods(namespace: str = "default"):
    """
    Get real Kubernetes pods from the cluster.
    """
    try:
        from app.services.k8s_client import K8sClient
        k8s = K8sClient()
        
        pods = k8s.list_pods(namespace=namespace)
        return {
            "namespace": namespace,
            "pods": pods,
            "count": len(pods)
        }
    except Exception as e:
        logger.error(f"Failed to get pods: {e}")
        return {
            "namespace": namespace,
            "pods": [],
            "count": 0,
            "error": str(e),
            "note": "K8s client not available. Make sure you're running in a cluster or have valid kubeconfig."
        }


@router.get("/k8s/services")
async def get_real_services(namespace: str = "default"):
    """
    Get real Kubernetes services from the cluster.
    """
    try:
        from app.services.k8s_client import K8sClient
        k8s = K8sClient()
        
        services = k8s.list_services(namespace=namespace)
        return {
            "namespace": namespace,
            "services": services,
            "count": len(services)
        }
    except Exception as e:
        logger.error(f"Failed to get services: {e}")
        return {
            "namespace": namespace,
            "services": [],
            "count": 0,
            "error": str(e),
            "note": "K8s client not available."
        }


@router.get("/k8s/namespaces")
async def get_real_namespaces():
    """
    Get real Kubernetes namespaces from the cluster.
    """
    try:
        from app.services.k8s_client import K8sClient
        k8s = K8sClient()
        
        namespaces = await k8s.list_namespaces()
        return {
            "namespaces": [
                {
                    "name": ns.metadata.name,
                    "status": ns.status.phase if ns.status else "Unknown",
                    "created": ns.metadata.creation_timestamp.isoformat() if ns.metadata.creation_timestamp else None
                }
                for ns in namespaces
            ]
        }
    except Exception as e:
        logger.error(f"Failed to get namespaces: {e}")
        return {
            "namespaces": [],
            "error": str(e),
            "note": "K8s client not available. Showing demo namespaces.",
            "demo_namespaces": [
                {"name": "default", "status": "Active"},
                {"name": "kube-system", "status": "Active"},
            ]
        }
