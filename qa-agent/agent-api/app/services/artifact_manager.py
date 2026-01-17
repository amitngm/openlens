"""
Artifact management for test runs.

Handles storage, retrieval, and cleanup of test artifacts.
"""

import logging
import os
import json
import shutil
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass

from app.utils.config import settings

logger = logging.getLogger(__name__)


@dataclass
class ArtifactInfo:
    """Information about an artifact."""
    name: str
    path: str
    size_bytes: int
    type: str
    created_at: datetime
    run_id: str


class ArtifactManager:
    """Manages test run artifacts."""
    
    ARTIFACT_TYPES = {
        '.png': 'screenshot',
        '.jpg': 'screenshot',
        '.jpeg': 'screenshot',
        '.webm': 'video',
        '.mp4': 'video',
        '.har': 'har',
        '.json': 'report',
        '.log': 'log',
        '.txt': 'log',
        '.html': 'report'
    }
    
    def __init__(self, base_path: Optional[str] = None):
        self.base_path = Path(base_path or settings.ARTIFACTS_PATH)
        self._ensure_base_path()
    
    def _ensure_base_path(self):
        """Ensure the base artifacts directory exists."""
        self.base_path.mkdir(parents=True, exist_ok=True)
        logger.info(f"Artifacts base path: {self.base_path}")
    
    def get_run_path(self, run_id: str) -> Path:
        """Get the artifact directory for a run."""
        return self.base_path / run_id
    
    def create_run_directory(self, run_id: str) -> Path:
        """Create artifact directory for a run."""
        run_path = self.get_run_path(run_id)
        run_path.mkdir(parents=True, exist_ok=True)
        
        # Create subdirectories
        (run_path / 'screenshots').mkdir(exist_ok=True)
        (run_path / 'videos').mkdir(exist_ok=True)
        (run_path / 'logs').mkdir(exist_ok=True)
        (run_path / 'reports').mkdir(exist_ok=True)
        
        logger.info(f"Created artifact directory for run {run_id}")
        return run_path
    
    def save_artifact(
        self,
        run_id: str,
        name: str,
        content: bytes,
        artifact_type: Optional[str] = None
    ) -> str:
        """
        Save an artifact.
        
        Args:
            run_id: Run identifier
            name: Artifact filename
            content: Artifact content
            artifact_type: Type override (auto-detected from extension if not provided)
        
        Returns:
            Relative path to saved artifact
        """
        run_path = self.get_run_path(run_id)
        if not run_path.exists():
            self.create_run_directory(run_id)
        
        # Determine type and subdirectory
        ext = Path(name).suffix.lower()
        detected_type = artifact_type or self.ARTIFACT_TYPES.get(ext, 'other')
        
        subdir_map = {
            'screenshot': 'screenshots',
            'video': 'videos',
            'log': 'logs',
            'report': 'reports',
            'har': 'reports'
        }
        subdir = subdir_map.get(detected_type, '')
        
        # Save file
        if subdir:
            file_path = run_path / subdir / name
        else:
            file_path = run_path / name
        
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_bytes(content)
        
        logger.info(f"Saved artifact: {file_path} ({len(content)} bytes)")
        return str(file_path.relative_to(self.base_path))
    
    def save_json_report(
        self,
        run_id: str,
        report_name: str,
        data: Dict[str, Any]
    ) -> str:
        """Save a JSON report."""
        content = json.dumps(data, indent=2, default=str).encode('utf-8')
        return self.save_artifact(run_id, report_name, content, 'report')
    
    def list_artifacts(self, run_id: str) -> List[ArtifactInfo]:
        """List all artifacts for a run."""
        run_path = self.get_run_path(run_id)
        if not run_path.exists():
            return []
        
        artifacts = []
        for file_path in run_path.rglob('*'):
            if file_path.is_file():
                ext = file_path.suffix.lower()
                artifact_type = self.ARTIFACT_TYPES.get(ext, 'other')
                
                stat = file_path.stat()
                artifacts.append(ArtifactInfo(
                    name=file_path.name,
                    path=str(file_path.relative_to(self.base_path)),
                    size_bytes=stat.st_size,
                    type=artifact_type,
                    created_at=datetime.fromtimestamp(stat.st_ctime),
                    run_id=run_id
                ))
        
        return artifacts
    
    def get_artifact(self, run_id: str, artifact_path: str) -> Optional[bytes]:
        """Get artifact content."""
        full_path = self.base_path / artifact_path
        
        # Security: ensure path is within base path
        try:
            full_path.resolve().relative_to(self.base_path.resolve())
        except ValueError:
            logger.error(f"Path traversal attempt: {artifact_path}")
            return None
        
        if not full_path.exists():
            return None
        
        return full_path.read_bytes()
    
    def get_artifact_path(self, run_id: str, artifact_path: str) -> Optional[Path]:
        """Get full path to an artifact."""
        full_path = self.base_path / artifact_path
        
        # Security: ensure path is within base path
        try:
            full_path.resolve().relative_to(self.base_path.resolve())
        except ValueError:
            logger.error(f"Path traversal attempt: {artifact_path}")
            return None
        
        if not full_path.exists():
            return None
        
        return full_path
    
    def delete_run_artifacts(self, run_id: str) -> bool:
        """Delete all artifacts for a run."""
        run_path = self.get_run_path(run_id)
        if not run_path.exists():
            return False
        
        try:
            shutil.rmtree(run_path)
            logger.info(f"Deleted artifacts for run {run_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete artifacts for run {run_id}: {e}")
            return False
    
    def cleanup_old_artifacts(self, retention_days: Optional[int] = None) -> int:
        """
        Clean up artifacts older than retention period.
        
        Returns:
            Number of run directories cleaned up
        """
        retention = retention_days or settings.ARTIFACTS_RETENTION_DAYS
        cutoff = datetime.utcnow() - timedelta(days=retention)
        
        cleaned = 0
        for run_dir in self.base_path.iterdir():
            if not run_dir.is_dir():
                continue
            
            # Check modification time
            mtime = datetime.fromtimestamp(run_dir.stat().st_mtime)
            if mtime < cutoff:
                try:
                    shutil.rmtree(run_dir)
                    cleaned += 1
                    logger.info(f"Cleaned up old artifacts: {run_dir.name}")
                except Exception as e:
                    logger.error(f"Failed to clean up {run_dir}: {e}")
        
        if cleaned > 0:
            logger.info(f"Cleaned up {cleaned} old artifact directories")
        
        return cleaned
    
    def get_storage_stats(self) -> Dict[str, Any]:
        """Get artifact storage statistics."""
        total_size = 0
        total_files = 0
        total_runs = 0
        
        for run_dir in self.base_path.iterdir():
            if run_dir.is_dir():
                total_runs += 1
                for file_path in run_dir.rglob('*'):
                    if file_path.is_file():
                        total_files += 1
                        total_size += file_path.stat().st_size
        
        return {
            "base_path": str(self.base_path),
            "total_runs": total_runs,
            "total_files": total_files,
            "total_size_bytes": total_size,
            "total_size_mb": round(total_size / (1024 * 1024), 2),
            "retention_days": settings.ARTIFACTS_RETENTION_DAYS
        }
