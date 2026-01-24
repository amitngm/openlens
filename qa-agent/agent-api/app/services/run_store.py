"""Run store for managing run contexts with persistence."""

import json
import logging
from pathlib import Path
from typing import Optional, Dict, List
from datetime import datetime

from app.models.run_context import RunContext, AuthConfig
from app.models.run_state import RunState

logger = logging.getLogger(__name__)


class RunStore:
    """In-memory run store with optional JSON persistence."""
    
    def __init__(self, base_path: Optional[Path] = None):
        """
        Initialize run store.
        
        Args:
            base_path: Base path for artifacts (defaults to ./data)
        """
        self._runs: Dict[str, RunContext] = {}
        self.base_path = base_path or Path("./data")
        self.base_path.mkdir(parents=True, exist_ok=True)
        logger.info(f"RunStore initialized with base_path: {self.base_path}")
    
    def create_run(
        self,
        run_id: str,
        base_url: str,
        env: str = "staging",
        headless: bool = True,
        auth: Optional[AuthConfig] = None,
        discovery_debug: bool = False,
        uploaded_images: Optional[list] = None,
        uploaded_documents: Optional[list] = None,
        test_phase: str = "phase1_get_operations"
    ) -> RunContext:
        """
        Create a new run context.
        
        Args:
            run_id: Unique run identifier
            base_url: Base application URL
            env: Environment name
            headless: Run browser in headless mode
            auth: Optional authentication configuration
        
        Returns:
            Created RunContext
        """
        artifacts_path = str(self.base_path / run_id)
        
        context = RunContext(
            run_id=run_id,
            base_url=base_url,
            env=env,
            headless=headless,
            auth=auth,
            state=RunState.START,
            artifacts_path=artifacts_path,
            discovery_debug=discovery_debug,
            uploaded_images=uploaded_images,
            uploaded_documents=uploaded_documents,
            test_phase=test_phase,
            timestamps={RunState.START.value: datetime.utcnow().isoformat() + "Z"}
        )
        
        self._runs[run_id] = context
        self.save_run(run_id)
        logger.info(f"Created run: {run_id}")
        return context
    
    def get_run(self, run_id: str) -> Optional[RunContext]:
        """Get run context by ID."""
        # Try in-memory first
        if run_id in self._runs:
            return self._runs[run_id]
        
        # Try loading from disk
        return self.load_run(run_id)
    
    def update_run(self, run_id: str, **updates) -> RunContext:
        """
        Update run context fields.
        
        Args:
            run_id: Run identifier
            **updates: Fields to update (e.g., state=RunState.WAIT_LOGIN_INPUT)
        
        Returns:
            Updated RunContext
        """
        if run_id not in self._runs:
            raise ValueError(f"Run not found: {run_id}")
        
        context = self._runs[run_id]
        
        # Update fields
        for key, value in updates.items():
            if hasattr(context, key):
                setattr(context, key, value)
        
        self.save_run(run_id)
        logger.debug(f"Updated run: {run_id}, updates: {list(updates.keys())}")
        return context
    
    def transition_state(self, run_id: str, new_state: RunState) -> RunContext:
        """
        Transition run to a new state and record timestamp.
        
        Args:
            run_id: Run identifier
            new_state: New state to transition to
        
        Returns:
            Updated RunContext
        """
        context = self.get_run(run_id)
        if not context:
            raise ValueError(f"Run not found: {run_id}")
        
        old_state = context.state
        context.state = new_state
        context.timestamps[new_state.value] = datetime.utcnow().isoformat() + "Z"
        
        self.save_run(run_id)
        logger.info(f"Run {run_id} transitioned: {old_state.value} -> {new_state.value}")
        return context
    
    def save_run(self, run_id: str) -> None:
        """Persist run context to JSON file."""
        if run_id not in self._runs:
            return
        
        context = self._runs[run_id]
        run_dir = self.base_path / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        
        file_path = run_dir / "run_context.json"
        
        # Convert to dict and serialize
        context_dict = context.model_dump()
        # Convert RunState enum to string
        context_dict["state"] = context.state.value
        
        with open(file_path, "w") as f:
            json.dump(context_dict, f, indent=2, default=str)
        
        logger.debug(f"Saved run context: {file_path}")
    
    def load_run(self, run_id: str) -> Optional[RunContext]:
        """
        Load run context from persisted file.
        
        Args:
            run_id: Run identifier
        
        Returns:
            RunContext if found, None otherwise
        """
        file_path = self.base_path / run_id / "run_context.json"
        if not file_path.exists():
            return None
        
        try:
            with open(file_path) as f:
                data = json.load(f)
            
            # Convert state string back to enum
            if "state" in data:
                data["state"] = RunState(data["state"])
            
            context = RunContext(**data)
            self._runs[run_id] = context
            logger.info(f"Loaded run from disk: {run_id}")
            return context
        except Exception as e:
            logger.error(f"Failed to load run {run_id}: {e}")
            return None
    
    def list_runs(self) -> List[RunContext]:
        """List all runs (in-memory only)."""
        return list(self._runs.values())
