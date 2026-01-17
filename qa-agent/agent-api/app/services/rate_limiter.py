"""
Rate limiter and concurrency control for test runs.

Prevents resource exhaustion and ensures controlled execution.
"""

import asyncio
import logging
from datetime import datetime
from typing import Dict, Optional, Set
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class RunInfo:
    """Information about an active run."""
    run_id: str
    flow_name: str
    started_at: datetime = field(default_factory=datetime.utcnow)


class RateLimiter:
    """
    Controls concurrent test run execution.
    
    Features:
    - Global concurrency limit
    - Per-flow concurrency limit
    - Active run tracking
    """
    
    def __init__(
        self,
        max_concurrent: int = 5,
        max_per_flow: int = 1
    ):
        self.max_concurrent = max_concurrent
        self.max_per_flow = max_per_flow
        
        self._active_runs: Dict[str, RunInfo] = {}
        self._flow_counts: Dict[str, int] = {}
        self._lock = asyncio.Lock()
        
        logger.info(
            f"RateLimiter initialized: max_concurrent={max_concurrent}, "
            f"max_per_flow={max_per_flow}"
        )
    
    async def acquire(self, run_id: str, flow_name: str) -> bool:
        """
        Try to acquire a slot for a run.
        
        Args:
            run_id: Unique run identifier
            flow_name: Name of the flow
        
        Returns:
            True if slot acquired, False if at limit
        """
        async with self._lock:
            # Check global limit
            if len(self._active_runs) >= self.max_concurrent:
                logger.warning(
                    f"Rate limit: max concurrent runs ({self.max_concurrent}) reached"
                )
                return False
            
            # Check per-flow limit
            current_flow_count = self._flow_counts.get(flow_name, 0)
            if current_flow_count >= self.max_per_flow:
                logger.warning(
                    f"Rate limit: max runs per flow ({self.max_per_flow}) "
                    f"reached for '{flow_name}'"
                )
                return False
            
            # Acquire slot
            self._active_runs[run_id] = RunInfo(
                run_id=run_id,
                flow_name=flow_name
            )
            self._flow_counts[flow_name] = current_flow_count + 1
            
            logger.info(
                f"Acquired slot for run {run_id} (flow: {flow_name}). "
                f"Active: {len(self._active_runs)}/{self.max_concurrent}"
            )
            
            return True
    
    async def release(self, run_id: str) -> bool:
        """
        Release a slot for a run.
        
        Args:
            run_id: Run identifier to release
        
        Returns:
            True if released, False if not found
        """
        async with self._lock:
            run_info = self._active_runs.pop(run_id, None)
            
            if run_info:
                flow_name = run_info.flow_name
                self._flow_counts[flow_name] = max(
                    0, self._flow_counts.get(flow_name, 1) - 1
                )
                
                logger.info(
                    f"Released slot for run {run_id}. "
                    f"Active: {len(self._active_runs)}/{self.max_concurrent}"
                )
                return True
            
            return False
    
    async def get_status(self) -> Dict:
        """Get current rate limiter status."""
        async with self._lock:
            return {
                "max_concurrent": self.max_concurrent,
                "max_per_flow": self.max_per_flow,
                "active_runs": len(self._active_runs),
                "available_slots": self.max_concurrent - len(self._active_runs),
                "flow_counts": dict(self._flow_counts),
                "active_run_ids": list(self._active_runs.keys())
            }
    
    async def is_flow_available(self, flow_name: str) -> bool:
        """Check if a flow can be executed."""
        async with self._lock:
            if len(self._active_runs) >= self.max_concurrent:
                return False
            
            current_flow_count = self._flow_counts.get(flow_name, 0)
            return current_flow_count < self.max_per_flow
    
    async def get_active_runs(self) -> list:
        """Get list of active runs."""
        async with self._lock:
            return [
                {
                    "run_id": info.run_id,
                    "flow_name": info.flow_name,
                    "started_at": info.started_at.isoformat()
                }
                for info in self._active_runs.values()
            ]
    
    async def force_release_all(self) -> int:
        """Force release all slots (for emergency/cleanup)."""
        async with self._lock:
            count = len(self._active_runs)
            self._active_runs.clear()
            self._flow_counts.clear()
            logger.warning(f"Force released all {count} active run slots")
            return count
