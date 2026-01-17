"""
Flow definition loader.

Loads and validates YAML flow definitions.
"""

import logging
import os
from pathlib import Path
from typing import Dict, List, Optional
import yaml

from app.models.flows import FlowDefinition, FlowStep, UIStep, APIStep, K8sStep, StepType
from app.utils.config import settings

logger = logging.getLogger(__name__)


class FlowLoader:
    """Loads and manages flow definitions."""
    
    FLOWS_DIR = os.environ.get('FLOWS_DIR', '/app/flows')
    
    def __init__(self, flows_dir: Optional[str] = None):
        self.flows_dir = Path(flows_dir or self.FLOWS_DIR)
        self._flows: Dict[str, FlowDefinition] = {}
        self._loaded = False
    
    def load_all(self) -> Dict[str, FlowDefinition]:
        """Load all flow definitions from the flows directory."""
        if not self.flows_dir.exists():
            logger.warning(f"Flows directory does not exist: {self.flows_dir}")
            return {}
        
        self._flows = {}
        
        for file_path in self.flows_dir.glob('**/*.yaml'):
            try:
                flow = self._load_file(file_path)
                if flow:
                    self._flows[flow.name] = flow
                    logger.info(f"Loaded flow: {flow.name} from {file_path}")
            except Exception as e:
                logger.error(f"Failed to load flow from {file_path}: {e}")
        
        for file_path in self.flows_dir.glob('**/*.yml'):
            try:
                flow = self._load_file(file_path)
                if flow:
                    self._flows[flow.name] = flow
                    logger.info(f"Loaded flow: {flow.name} from {file_path}")
            except Exception as e:
                logger.error(f"Failed to load flow from {file_path}: {e}")
        
        self._loaded = True
        logger.info(f"Loaded {len(self._flows)} flows")
        return self._flows
    
    def _load_file(self, file_path: Path) -> Optional[FlowDefinition]:
        """Load a single flow definition file."""
        with open(file_path, 'r') as f:
            data = yaml.safe_load(f)
        
        if not data:
            return None
        
        # Parse steps
        steps = self._parse_steps(data.get('steps', []))
        setup = self._parse_steps(data.get('setup', []))
        teardown = self._parse_steps(data.get('teardown', []))
        
        return FlowDefinition(
            name=data.get('name', file_path.stem),
            description=data.get('description'),
            version=data.get('version', '1.0.0'),
            tags=data.get('tags', []),
            author=data.get('author'),
            allowed_environments=data.get('allowed_environments', ['dev', 'staging']),
            required_variables=data.get('required_variables', []),
            default_variables=data.get('default_variables', {}),
            setup=setup,
            steps=steps,
            teardown=teardown,
            timeout_ms=data.get('timeout_ms', 600000),
            parallel=data.get('parallel', False),
            capture_screenshots=data.get('capture_screenshots', True),
            capture_video=data.get('capture_video', False),
            capture_har=data.get('capture_har', True)
        )
    
    def _parse_steps(self, steps_data: List[Dict]) -> List[FlowStep]:
        """Parse step definitions."""
        steps = []
        
        for step_data in steps_data:
            step_type = StepType(step_data.get('type', 'api'))
            
            ui_step = None
            api_step = None
            k8s_step = None
            
            if step_type == StepType.UI and 'ui' in step_data:
                ui_config = step_data['ui']
                ui_step = UIStep(
                    action=ui_config.get('action', 'navigate'),
                    selector=ui_config.get('selector'),
                    value=ui_config.get('value'),
                    url=ui_config.get('url'),
                    timeout_ms=ui_config.get('timeout_ms', 30000),
                    screenshot=ui_config.get('screenshot', False),
                    assertions=ui_config.get('assertions', []),
                    wait_for=ui_config.get('wait_for'),
                    wait_timeout_ms=ui_config.get('wait_timeout_ms', 10000)
                )
            
            elif step_type == StepType.API and 'api' in step_data:
                api_config = step_data['api']
                api_step = APIStep(
                    method=api_config.get('method', 'GET'),
                    url=api_config.get('url', ''),
                    headers=api_config.get('headers', {}),
                    body=api_config.get('body'),
                    query_params=api_config.get('query_params', {}),
                    bearer_token=api_config.get('bearer_token'),
                    timeout_ms=api_config.get('timeout_ms', 30000),
                    retries=api_config.get('retries', 0),
                    retry_delay_ms=api_config.get('retry_delay_ms', 1000),
                    expected_status=api_config.get('expected_status', 200),
                    assertions=api_config.get('assertions', []),
                    extract=api_config.get('extract', {}),
                    log_response=api_config.get('log_response', True)
                )
            
            elif step_type == StepType.K8S and 'k8s' in step_data:
                k8s_config = step_data['k8s']
                k8s_step = K8sStep(
                    check_type=k8s_config.get('check_type', 'pod_ready'),
                    resource_type=k8s_config.get('resource_type', 'pod'),
                    resource_name=k8s_config.get('resource_name'),
                    label_selector=k8s_config.get('label_selector'),
                    namespace=k8s_config.get('namespace'),
                    log_pattern=k8s_config.get('log_pattern'),
                    container=k8s_config.get('container'),
                    timeout_ms=k8s_config.get('timeout_ms', 60000),
                    assertions=k8s_config.get('assertions', [])
                )
            
            steps.append(FlowStep(
                name=step_data.get('name', f'step_{len(steps)+1}'),
                description=step_data.get('description'),
                type=step_type,
                ui=ui_step,
                api=api_step,
                k8s=k8s_step,
                continue_on_failure=step_data.get('continue_on_failure', False),
                skip_condition=step_data.get('skip_condition'),
                retry_count=step_data.get('retry_count', 0),
                wait_before_ms=step_data.get('wait_before_ms', 0),
                wait_after_ms=step_data.get('wait_after_ms', 0)
            ))
        
        return steps
    
    def get_flow(self, name: str) -> Optional[FlowDefinition]:
        """Get a flow by name."""
        if not self._loaded:
            self.load_all()
        return self._flows.get(name)
    
    def list_flows(self) -> List[str]:
        """List all available flow names."""
        if not self._loaded:
            self.load_all()
        return list(self._flows.keys())
    
    def get_flow_info(self, name: str) -> Optional[Dict]:
        """Get flow information without full definition."""
        flow = self.get_flow(name)
        if not flow:
            return None
        
        return {
            "name": flow.name,
            "description": flow.description,
            "version": flow.version,
            "tags": flow.tags,
            "allowed_environments": flow.allowed_environments,
            "required_variables": flow.required_variables,
            "step_count": len(flow.steps)
        }
    
    def reload(self) -> int:
        """Reload all flows."""
        self._loaded = False
        self._flows = {}
        flows = self.load_all()
        return len(flows)
