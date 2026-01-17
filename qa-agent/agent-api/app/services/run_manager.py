"""
Test run management service.

Orchestrates test execution, job creation, and result tracking.
"""

import asyncio
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from app.models.runs import (
    RunRequest,
    RunResponse,
    RunSummary,
    RunState,
    StepResult,
)
from app.models.flows import FlowDefinition
from app.services.k8s_client import get_k8s_client
from app.services.flow_loader import FlowLoader
from app.services.artifact_manager import ArtifactManager
from app.services.rate_limiter import RateLimiter
from app.utils.config import settings
from app.utils.guards import check_all_guards
from app.utils.logging import redact_dict

logger = logging.getLogger(__name__)


class RunManager:
    """Manages test run lifecycle."""
    
    def __init__(
        self,
        flow_loader: FlowLoader,
        artifact_manager: ArtifactManager,
        rate_limiter: RateLimiter
    ):
        self.flow_loader = flow_loader
        self.artifact_manager = artifact_manager
        self.rate_limiter = rate_limiter
        
        # In-memory run tracking (would be Redis/DB in production)
        self._runs: Dict[str, RunSummary] = {}
    
    async def create_run(self, request: RunRequest) -> RunResponse:
        """
        Create and start a new test run.
        
        Args:
            request: Run request with flow name, env, and variables
        
        Returns:
            RunResponse with run_id and initial status
        """
        # Generate run ID
        run_id = f"run-{uuid.uuid4().hex[:12]}"
        
        # Validate flow exists
        flow = self.flow_loader.get_flow(request.flow_name)
        if not flow:
            raise ValueError(f"Flow not found: {request.flow_name}")
        
        # Check security guards
        check_all_guards(
            env=request.env,
            flow_name=request.flow_name,
            variables=request.variables,
            tenant=request.tenant,
            force_allow_prod=request.force_allow_prod
        )
        
        # Validate environment
        if request.env not in flow.allowed_environments:
            raise ValueError(
                f"Environment '{request.env}' not allowed for flow '{request.flow_name}'. "
                f"Allowed: {flow.allowed_environments}"
            )
        
        # Check rate limits
        if not await self.rate_limiter.acquire(run_id, request.flow_name):
            raise ValueError(
                f"Rate limit exceeded for flow '{request.flow_name}'. "
                f"Please wait for current runs to complete."
            )
        
        # Validate required variables
        missing_vars = [
            v for v in flow.required_variables
            if v not in request.variables and v not in flow.default_variables
        ]
        if missing_vars:
            await self.rate_limiter.release(run_id)
            raise ValueError(f"Missing required variables: {missing_vars}")
        
        # Create run summary
        now = datetime.utcnow()
        run_summary = RunSummary(
            run_id=run_id,
            flow_name=request.flow_name,
            env=request.env,
            tenant=request.tenant,
            project=request.project,
            status=RunState.PENDING,
            created_at=now,
            total_steps=len(flow.steps) + len(flow.setup) + len(flow.teardown),
            tags=request.tags,
            variables=redact_dict(request.variables)
        )
        
        self._runs[run_id] = run_summary
        
        # Create artifact directory
        self.artifact_manager.create_run_directory(run_id)
        
        # Start execution (async)
        asyncio.create_task(self._execute_run(run_id, request, flow))
        
        logger.info(f"Created run {run_id} for flow '{request.flow_name}'")
        
        return RunResponse(
            run_id=run_id,
            flow_name=request.flow_name,
            env=request.env,
            status=RunState.PENDING,
            created_at=now,
            message="Run created and queued for execution"
        )
    
    async def _execute_run(
        self,
        run_id: str,
        request: RunRequest,
        flow: FlowDefinition
    ):
        """Execute a test run."""
        try:
            # Update status to running
            self._runs[run_id].status = RunState.RUNNING
            self._runs[run_id].started_at = datetime.utcnow()
            
            logger.info(f"Starting execution of run {run_id}")
            
            # Merge variables with defaults
            variables = {**flow.default_variables, **request.variables}
            
            # Create runner job in Kubernetes
            job_result = await self._create_runner_job(
                run_id=run_id,
                flow=flow,
                env=request.env,
                tenant=request.tenant,
                project=request.project,
                variables=variables
            )
            
            if job_result:
                # Monitor job until completion
                await self._monitor_job(run_id, job_result['name'])
            else:
                # Fallback: execute locally (for development)
                await self._execute_locally(run_id, flow, variables)
            
        except Exception as e:
            logger.error(f"Run {run_id} failed: {e}", exc_info=True)
            self._runs[run_id].status = RunState.FAILED
            self._runs[run_id].error = str(e)
        finally:
            # Mark completion
            self._runs[run_id].completed_at = datetime.utcnow()
            if self._runs[run_id].started_at:
                duration = (
                    self._runs[run_id].completed_at - 
                    self._runs[run_id].started_at
                )
                self._runs[run_id].duration_ms = int(duration.total_seconds() * 1000)
            
            # Release rate limiter
            await self.rate_limiter.release(run_id)
            
            # Save final report
            self._save_run_report(run_id)
            
            logger.info(
                f"Run {run_id} completed with status: {self._runs[run_id].status}"
            )
    
    async def _create_runner_job(
        self,
        run_id: str,
        flow: FlowDefinition,
        env: str,
        tenant: Optional[str],
        project: Optional[str],
        variables: Dict[str, Any]
    ) -> Optional[Dict]:
        """Create a Kubernetes job to run the tests."""
        try:
            k8s = get_k8s_client()
            
            # Build job configuration
            job_name = f"qa-runner-{run_id}"
            
            # Environment variables for runner
            env_vars = {
                "RUN_ID": run_id,
                "FLOW_NAME": flow.name,
                "TARGET_ENV": env,
                "UI_BASE_URL": settings.UI_BASE_URL,
                "API_BASE_URL": settings.API_BASE_URL,
                "ARTIFACTS_PATH": f"/data/artifacts/{run_id}",
            }
            
            if tenant:
                env_vars["TENANT"] = tenant
            if project:
                env_vars["PROJECT"] = project
            
            # Command to run
            command = [
                "node",
                "/app/runner/src/index.js",
                "--flow", flow.name,
                "--run-id", run_id
            ]
            
            result = k8s.create_job(
                name=job_name,
                image=settings.RUNNER_IMAGE,
                command=command,
                namespace=settings.NAMESPACE,
                env=env_vars,
                service_account="qa-agent-runner",
                labels={
                    "app": "qa-agent-runner",
                    "run-id": run_id,
                    "flow": flow.name
                },
                resources={
                    "limits": {
                        "memory": settings.RUNNER_MEMORY_LIMIT,
                        "cpu": settings.RUNNER_CPU_LIMIT
                    },
                    "requests": {
                        "memory": "512Mi",
                        "cpu": "250m"
                    }
                }
            )
            
            logger.info(f"Created runner job: {job_name}")
            return result
            
        except Exception as e:
            logger.warning(
                f"Failed to create K8s job, will execute locally: {e}"
            )
            return None
    
    async def _monitor_job(self, run_id: str, job_name: str):
        """Monitor a Kubernetes job until completion."""
        k8s = get_k8s_client()
        timeout = settings.RUNNER_TIMEOUT_SECONDS
        elapsed = 0
        poll_interval = 5
        
        while elapsed < timeout:
            status = k8s.get_job_status(job_name)
            
            if status.get('succeeded', 0) > 0:
                self._runs[run_id].status = RunState.COMPLETED
                logger.info(f"Runner job {job_name} succeeded")
                return
            
            if status.get('failed', 0) > 0:
                self._runs[run_id].status = RunState.FAILED
                self._runs[run_id].error = "Runner job failed"
                logger.error(f"Runner job {job_name} failed")
                return
            
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
        
        # Timeout
        self._runs[run_id].status = RunState.TIMEOUT
        self._runs[run_id].error = f"Runner job timed out after {timeout}s"
        logger.error(f"Runner job {job_name} timed out")
    
    async def _execute_locally(
        self,
        run_id: str,
        flow: FlowDefinition,
        variables: Dict[str, Any]
    ):
        """Execute flow locally (development fallback)."""
        logger.info(f"Executing run {run_id} locally (development mode)")
        
        steps_results = []
        passed = 0
        failed = 0
        
        # Execute setup steps
        for step in flow.setup:
            result = await self._execute_step(step, variables)
            steps_results.append(result)
            if result.status == 'pass':
                passed += 1
            else:
                failed += 1
        
        # Execute main steps
        for step in flow.steps:
            result = await self._execute_step(step, variables)
            steps_results.append(result)
            if result.status == 'pass':
                passed += 1
            else:
                failed += 1
                if not step.continue_on_failure:
                    break
        
        # Execute teardown steps
        for step in flow.teardown:
            result = await self._execute_step(step, variables)
            steps_results.append(result)
            if result.status == 'pass':
                passed += 1
            else:
                failed += 1
        
        # Update run summary
        self._runs[run_id].steps = steps_results
        self._runs[run_id].passed_steps = passed
        self._runs[run_id].failed_steps = failed
        self._runs[run_id].status = (
            RunState.COMPLETED if failed == 0 else RunState.FAILED
        )
    
    async def _execute_step(
        self,
        step,
        variables: Dict[str, Any]
    ) -> StepResult:
        """Execute a single step (placeholder)."""
        start_time = datetime.utcnow()
        
        # Simulate step execution
        await asyncio.sleep(0.1)
        
        end_time = datetime.utcnow()
        duration_ms = int((end_time - start_time).total_seconds() * 1000)
        
        return StepResult(
            step_name=step.name,
            step_type=step.type.value,
            status='pass',
            start_time=start_time,
            end_time=end_time,
            duration_ms=duration_ms,
            message=f"Step '{step.name}' executed (placeholder)",
            assertions=[],
            artifacts=[],
            metadata={"type": step.type.value}
        )
    
    def _save_run_report(self, run_id: str):
        """Save the final run report."""
        run = self._runs.get(run_id)
        if not run:
            return
        
        report = {
            "run_id": run.run_id,
            "flow_name": run.flow_name,
            "environment": run.env,
            "tenant": run.tenant,
            "project": run.project,
            "status": run.status.value,
            "created_at": run.created_at.isoformat(),
            "started_at": run.started_at.isoformat() if run.started_at else None,
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
            "duration_ms": run.duration_ms,
            "summary": {
                "total_steps": run.total_steps,
                "passed": run.passed_steps,
                "failed": run.failed_steps,
                "skipped": run.skipped_steps,
                "success_rate": run.success_rate
            },
            "steps": [
                {
                    "name": s.step_name,
                    "type": s.step_type,
                    "status": s.status,
                    "duration_ms": s.duration_ms,
                    "message": s.message
                }
                for s in run.steps
            ],
            "error": run.error,
            "tags": run.tags
        }
        
        self.artifact_manager.save_json_report(
            run_id,
            "report.json",
            report
        )
    
    async def get_run(self, run_id: str) -> Optional[RunSummary]:
        """Get run details."""
        return self._runs.get(run_id)
    
    async def list_runs(
        self,
        flow_name: Optional[str] = None,
        status: Optional[RunState] = None,
        limit: int = 50
    ) -> List[RunSummary]:
        """List runs with optional filters."""
        runs = list(self._runs.values())
        
        if flow_name:
            runs = [r for r in runs if r.flow_name == flow_name]
        
        if status:
            runs = [r for r in runs if r.status == status]
        
        # Sort by created_at descending
        runs.sort(key=lambda r: r.created_at, reverse=True)
        
        return runs[:limit]
    
    async def cancel_run(self, run_id: str) -> bool:
        """Cancel a running test."""
        run = self._runs.get(run_id)
        if not run:
            return False
        
        if run.status not in [RunState.PENDING, RunState.RUNNING]:
            return False
        
        run.status = RunState.CANCELLED
        run.completed_at = datetime.utcnow()
        
        # Try to delete the K8s job
        try:
            k8s = get_k8s_client()
            k8s.delete_job(f"qa-runner-{run_id}")
        except Exception as e:
            logger.warning(f"Failed to delete runner job: {e}")
        
        await self.rate_limiter.release(run_id)
        
        logger.info(f"Cancelled run {run_id}")
        return True
