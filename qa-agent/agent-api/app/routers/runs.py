"""Test run management endpoints."""

import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Request, Query

from app.models.runs import (
    RunRequest,
    RunResponse,
    RunSummary,
    RunState,
    RunListResponse,
)
from app.services.run_manager import RunManager
from app.services.flow_loader import FlowLoader
from app.services.artifact_manager import ArtifactManager

logger = logging.getLogger(__name__)
router = APIRouter()


def get_run_manager(request: Request) -> RunManager:
    """Get or create RunManager instance."""
    if not hasattr(request.app.state, 'run_manager'):
        request.app.state.run_manager = RunManager(
            flow_loader=FlowLoader(),
            artifact_manager=ArtifactManager(),
            rate_limiter=request.app.state.rate_limiter
        )
    return request.app.state.run_manager


@router.post("", response_model=RunResponse)
async def create_run(request: Request, run_request: RunRequest):
    """
    Create and start a new test run.
    
    Security guards will block:
    - Production environments (unless in allowlist)
    - Missing testTenant=true variable
    
    Rate limits:
    - Max concurrent runs globally
    - Max concurrent runs per flow
    """
    manager = get_run_manager(request)
    
    try:
        response = await manager.create_run(run_request)
        return response
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to create run: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to create run")


@router.get("/{run_id}", response_model=RunSummary)
async def get_run(request: Request, run_id: str):
    """Get run status and summary."""
    manager = get_run_manager(request)
    
    run = await manager.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Run not found: {run_id}")
    
    return run


@router.get("", response_model=RunListResponse)
async def list_runs(
    request: Request,
    flow_name: Optional[str] = Query(None, description="Filter by flow name"),
    status: Optional[RunState] = Query(None, description="Filter by status"),
    limit: int = Query(50, ge=1, le=100, description="Max results"),
    page: int = Query(1, ge=1, description="Page number")
):
    """List test runs with optional filters."""
    manager = get_run_manager(request)
    
    runs = await manager.list_runs(
        flow_name=flow_name,
        status=status,
        limit=limit * page  # Get enough for pagination
    )
    
    # Simple pagination
    start_idx = (page - 1) * limit
    end_idx = start_idx + limit
    paginated = runs[start_idx:end_idx]
    
    return RunListResponse(
        runs=paginated,
        total=len(runs),
        page=page,
        page_size=limit
    )


@router.post("/{run_id}/cancel")
async def cancel_run(request: Request, run_id: str):
    """Cancel a running test."""
    manager = get_run_manager(request)
    
    success = await manager.cancel_run(run_id)
    if not success:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot cancel run {run_id} (not found or not running)"
        )
    
    return {"message": f"Run {run_id} cancelled", "run_id": run_id}


@router.get("/{run_id}/status")
async def get_run_status(request: Request, run_id: str):
    """Get brief run status (for polling)."""
    manager = get_run_manager(request)
    
    run = await manager.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Run not found: {run_id}")
    
    # Calculate progress
    total = run.total_steps or 1
    completed = run.passed_steps + run.failed_steps + run.skipped_steps
    progress = int((completed / total) * 100)
    
    current_step = None
    if run.steps and run.status == RunState.RUNNING:
        current_step = run.steps[-1].step_name if run.steps else None
    
    return {
        "run_id": run.run_id,
        "status": run.status.value,
        "progress": progress,
        "current_step": current_step,
        "passed": run.passed_steps,
        "failed": run.failed_steps,
        "total": run.total_steps
    }


@router.get("/rate-limit/status")
async def get_rate_limit_status(request: Request):
    """Get current rate limiter status."""
    if not hasattr(request.app.state, 'rate_limiter'):
        raise HTTPException(status_code=503, detail="Rate limiter not initialized")
    
    status = await request.app.state.rate_limiter.get_status()
    return status


@router.get("/flows/list")
async def list_available_flows(request: Request):
    """List all available flows."""
    manager = get_run_manager(request)
    
    flows = manager.flow_loader.list_flows()
    flow_infos = []
    
    for flow_name in flows:
        info = manager.flow_loader.get_flow_info(flow_name)
        if info:
            flow_infos.append(info)
    
    return {
        "flows": flow_infos,
        "total": len(flow_infos)
    }


@router.get("/flows/{flow_name}")
async def get_flow_info(request: Request, flow_name: str):
    """Get details about a specific flow."""
    manager = get_run_manager(request)
    
    info = manager.flow_loader.get_flow_info(flow_name)
    if not info:
        raise HTTPException(status_code=404, detail=f"Flow not found: {flow_name}")
    
    return info


@router.post("/flows/reload")
async def reload_flows(request: Request):
    """Reload all flow definitions."""
    manager = get_run_manager(request)
    
    count = manager.flow_loader.reload()
    return {
        "message": f"Reloaded {count} flows",
        "count": count
    }
