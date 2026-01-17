"""Artifact management endpoints."""

import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Request, Query
from fastapi.responses import FileResponse, StreamingResponse
import mimetypes

from app.services.artifact_manager import ArtifactManager

logger = logging.getLogger(__name__)
router = APIRouter()


def get_artifact_manager(request: Request) -> ArtifactManager:
    """Get or create ArtifactManager instance."""
    if not hasattr(request.app.state, 'artifact_manager'):
        request.app.state.artifact_manager = ArtifactManager()
    return request.app.state.artifact_manager


@router.get("/{run_id}")
async def list_run_artifacts(request: Request, run_id: str):
    """
    List all artifacts for a run.
    
    Returns artifact metadata with download links.
    """
    manager = get_artifact_manager(request)
    
    artifacts = manager.list_artifacts(run_id)
    
    if not artifacts:
        # Check if run exists but has no artifacts
        run_path = manager.get_run_path(run_id)
        if not run_path.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Run not found: {run_id}"
            )
    
    return {
        "run_id": run_id,
        "artifacts": [
            {
                "name": a.name,
                "path": a.path,
                "type": a.type,
                "size_bytes": a.size_bytes,
                "created_at": a.created_at.isoformat(),
                "download_url": f"/artifacts/{run_id}/download/{a.path}"
            }
            for a in artifacts
        ],
        "total": len(artifacts)
    }


@router.get("/{run_id}/download/{artifact_path:path}")
async def download_artifact(
    request: Request,
    run_id: str,
    artifact_path: str
):
    """
    Download a specific artifact.
    
    Returns the artifact file with appropriate content-type.
    """
    manager = get_artifact_manager(request)
    
    # Construct full path (artifact_path should already include run_id prefix)
    if not artifact_path.startswith(run_id):
        artifact_path = f"{run_id}/{artifact_path}"
    
    file_path = manager.get_artifact_path(run_id, artifact_path)
    
    if not file_path:
        raise HTTPException(
            status_code=404,
            detail=f"Artifact not found: {artifact_path}"
        )
    
    # Determine content type
    content_type, _ = mimetypes.guess_type(str(file_path))
    if not content_type:
        content_type = "application/octet-stream"
    
    return FileResponse(
        path=file_path,
        filename=file_path.name,
        media_type=content_type
    )


@router.get("/{run_id}/report")
async def get_run_report(request: Request, run_id: str):
    """
    Get the JSON test report for a run.
    
    Returns the structured test report with step-level results.
    """
    manager = get_artifact_manager(request)
    
    # Try to find report.json
    report_path = f"{run_id}/reports/report.json"
    content = manager.get_artifact(run_id, report_path)
    
    if not content:
        # Try alternate location
        report_path = f"{run_id}/report.json"
        content = manager.get_artifact(run_id, report_path)
    
    if not content:
        raise HTTPException(
            status_code=404,
            detail=f"Report not found for run: {run_id}"
        )
    
    import json
    return json.loads(content)


@router.get("/{run_id}/screenshots")
async def list_screenshots(request: Request, run_id: str):
    """List all screenshots for a run."""
    manager = get_artifact_manager(request)
    
    artifacts = manager.list_artifacts(run_id)
    screenshots = [a for a in artifacts if a.type == 'screenshot']
    
    return {
        "run_id": run_id,
        "screenshots": [
            {
                "name": s.name,
                "path": s.path,
                "size_bytes": s.size_bytes,
                "created_at": s.created_at.isoformat(),
                "download_url": f"/artifacts/{run_id}/download/{s.path}"
            }
            for s in screenshots
        ],
        "total": len(screenshots)
    }


@router.get("/{run_id}/har")
async def get_har_log(request: Request, run_id: str):
    """
    Get the HAR (HTTP Archive) log for a run.
    
    Returns network activity captured during UI testing.
    """
    manager = get_artifact_manager(request)
    
    artifacts = manager.list_artifacts(run_id)
    har_files = [a for a in artifacts if a.type == 'har']
    
    if not har_files:
        raise HTTPException(
            status_code=404,
            detail=f"No HAR log found for run: {run_id}"
        )
    
    # Return the first HAR file content
    content = manager.get_artifact(run_id, har_files[0].path)
    if not content:
        raise HTTPException(
            status_code=404,
            detail=f"Failed to read HAR log"
        )
    
    import json
    return json.loads(content)


@router.delete("/{run_id}")
async def delete_run_artifacts(request: Request, run_id: str):
    """Delete all artifacts for a run."""
    manager = get_artifact_manager(request)
    
    success = manager.delete_run_artifacts(run_id)
    
    if not success:
        raise HTTPException(
            status_code=404,
            detail=f"Run not found or already deleted: {run_id}"
        )
    
    return {"message": f"Artifacts deleted for run: {run_id}"}


@router.post("/cleanup")
async def cleanup_old_artifacts(
    request: Request,
    retention_days: Optional[int] = Query(
        None,
        description="Override retention period (days)"
    )
):
    """
    Clean up old artifacts beyond retention period.
    
    Admin endpoint for manual cleanup.
    """
    manager = get_artifact_manager(request)
    
    cleaned = manager.cleanup_old_artifacts(retention_days)
    
    return {
        "message": f"Cleaned up {cleaned} old run directories",
        "cleaned_count": cleaned
    }


@router.get("/stats")
async def get_storage_stats(request: Request):
    """Get artifact storage statistics."""
    manager = get_artifact_manager(request)
    
    return manager.get_storage_stats()
