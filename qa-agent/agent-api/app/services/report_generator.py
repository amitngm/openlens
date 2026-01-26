"""Report generator service for creating HTML reports from JSON results."""

import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime

logger = logging.getLogger(__name__)


class ReportGenerator:
    """Service for generating HTML reports from test results."""
    
    def generate_html_report(
        self,
        run_id: str,
        artifacts_path: str
    ) -> Dict[str, Any]:
        """
        Generate HTML report from report.json and discovery_summary.json.
        
        Args:
            run_id: Run identifier
            artifacts_path: Path to artifacts directory
        
        Returns:
            Dict with:
                - html_path: Path to generated HTML file
                - next_state: RunState (DONE)
        """
        try:
            artifacts_dir = Path(artifacts_path)
            artifacts_dir.mkdir(parents=True, exist_ok=True)
            
            html_report_path = artifacts_dir / "report.html"
            
            # Check if HTML report already exists
            if html_report_path.exists():
                logger.info(f"[{run_id}] HTML report already exists, skipping generation")
                return {
                    "html_path": str(html_report_path),
                    "next_state": "DONE",
                    "skipped": True
                }
            
            # Load report.json
            report_file = artifacts_dir / "report.json"
            if not report_file.exists():
                raise FileNotFoundError("report.json not found")
            
            with open(report_file) as f:
                report_data = json.load(f)
            
            # Load discovery_summary.json (optional)
            discovery_summary_file = artifacts_dir / "discovery_summary.json"
            discovery_summary = {}
            if discovery_summary_file.exists():
                with open(discovery_summary_file) as f:
                    discovery_summary = json.load(f)
            
            # Generate HTML
            html_content = self._generate_html(
                run_id=run_id,
                report_data=report_data,
                discovery_summary=discovery_summary,
                artifacts_dir=artifacts_dir
            )
            
            # Save HTML file
            with open(html_report_path, "w", encoding="utf-8") as f:
                f.write(html_content)
            
            logger.info(f"[{run_id}] HTML report generated: {html_report_path}")
            
            return {
                "html_path": str(html_report_path),
                "next_state": "DONE",
                "skipped": False
            }
        
        except Exception as e:
            logger.error(f"[{run_id}] HTML report generation failed: {e}", exc_info=True)
            raise
    
    def _generate_html(
        self,
        run_id: str,
        report_data: Dict[str, Any],
        discovery_summary: Dict[str, Any],
        artifacts_dir: Path
    ) -> str:
        """Generate HTML content from report data."""
        
        # Calculate relative paths for artifacts
        def get_relative_path(file_path: str) -> str:
            """Get relative path from artifacts directory."""
            try:
                full_path = Path(file_path)
                if full_path.is_absolute():
                    # If absolute, try to make relative
                    try:
                        return str(full_path.relative_to(artifacts_dir))
                    except ValueError:
                        # If not relative, use filename only
                        return full_path.name
                return file_path
            except:
                return file_path
        
        # Extract report metadata
        status = report_data.get("status", "unknown")
        total_tests = report_data.get("total_tests", 0)
        passed = report_data.get("passed", 0)
        failed = report_data.get("failed", 0)
        skipped = report_data.get("skipped", 0)
        started_at = report_data.get("started_at", "")
        completed_at = report_data.get("completed_at", "")
        test_intent = report_data.get("test_intent", "unknown")
        
        # Calculate duration
        duration = ""
        if started_at and completed_at:
            try:
                start = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
                end = datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
                delta = end - start
                duration = f"{delta.total_seconds():.1f}s"
            except:
                pass
        
        # Generate test results HTML
        tests_html = ""
        tests = report_data.get("tests", [])
        
        for idx, test in enumerate(tests):
            test_id = test.get("test_id", f"TEST-{idx:03d}")
            test_name = test.get("name", "Unknown test")
            test_status = test.get("status", "unknown")
            test_duration = test.get("duration_ms", 0) / 1000.0
            test_error = test.get("error")
            evidence = test.get("evidence", [])
            
            status_class = {
                "passed": "success",
                "failed": "danger",
                "skipped": "warning",
                "error": "danger"
            }.get(test_status, "secondary")
            
            # Evidence links
            evidence_html = ""
            if evidence:
                evidence_html = "<div class='evidence'>"
                for ev in evidence:
                    ev_path = get_relative_path(ev)
                    if ev_path.endswith(('.png', '.jpg', '.jpeg')):
                        evidence_html += f'<a href="{ev_path}" target="_blank"><img src="{ev_path}" alt="Screenshot" style="max-width: 200px; margin: 5px;"></a>'
                    elif ev_path.endswith(('.mp4', '.webm')):
                        evidence_html += f'<a href="{ev_path}" target="_blank">📹 Video</a> '
                    elif ev_path.endswith(('.har', '.zip')):
                        evidence_html += f'<a href="{ev_path}" target="_blank">📄 HAR/Trace</a> '
                    else:
                        evidence_html += f'<a href="{ev_path}" target="_blank">📎 {ev_path}</a> '
                evidence_html += "</div>"
            
            # Steps HTML
            steps_html = ""
            steps = test.get("steps", [])
            for step_idx, step in enumerate(steps):
                step_action = step.get("action", "unknown")
                step_status = step.get("status", "unknown")
                step_duration = step.get("duration_ms", 0) / 1000.0
                step_error = step.get("error")
                
                step_status_class = {
                    "passed": "success",
                    "failed": "danger",
                    "skipped": "warning"
                }.get(step_status, "secondary")
                
                steps_html += f"""
                <tr>
                    <td>{step_idx + 1}</td>
                    <td>{step_action}</td>
                    <td><span class="badge bg-{step_status_class}">{step_status}</span></td>
                    <td>{step_duration:.2f}s</td>
                    <td>{step_error or ""}</td>
                </tr>
                """
            
            error_html = f'<div class="alert alert-danger">{test_error}</div>' if test_error else ""
            
            tests_html += f"""
            <div class="test-result mb-4">
                <div class="card">
                    <div class="card-header d-flex justify-content-between align-items-center">
                        <div>
                            <h5 class="mb-0">{test_name}</h5>
                            <small class="text-muted">ID: {test_id}</small>
                        </div>
                        <div>
                            <span class="badge bg-{status_class}">{test_status}</span>
                            <span class="text-muted ms-2">{test_duration:.2f}s</span>
                        </div>
                    </div>
                    <div class="card-body">
                        {error_html}
                        {evidence_html}
                        <h6>Steps:</h6>
                        <table class="table table-sm">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Action</th>
                                    <th>Status</th>
                                    <th>Duration</th>
                                    <th>Error</th>
                                </tr>
                            </thead>
                            <tbody>
                                {steps_html}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            """
        
        # Discovery summary HTML
        discovery_html = ""
        if discovery_summary:
            pages_count = discovery_summary.get("pages_count", 0)
            forms_count = discovery_summary.get("forms_count", 0)
            crud_count = discovery_summary.get("potential_crud_actions_count", 0)
            errors_count = discovery_summary.get("network_errors_count", 0)
            slow_count = discovery_summary.get("slow_requests_count", 0)
            
            discovery_html = f"""
            <div class="card mb-4">
                <div class="card-header">
                    <h5>Discovery Summary</h5>
                </div>
                <div class="card-body">
                    <div class="row">
                        <div class="col-md-3">
                            <strong>Pages:</strong> {pages_count}
                        </div>
                        <div class="col-md-3">
                            <strong>Forms:</strong> {forms_count}
                        </div>
                        <div class="col-md-3">
                            <strong>CRUD Actions:</strong> {crud_count}
                        </div>
                        <div class="col-md-3">
                            <strong>Network Errors:</strong> {errors_count}
                        </div>
                    </div>
                    <div class="row mt-2">
                        <div class="col-md-3">
                            <strong>Slow Requests:</strong> {slow_count}
                        </div>
                    </div>
                </div>
            </div>
            """
        
        # Generate full HTML
        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test Report - {run_id}</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body {{
            padding: 20px;
            background-color: #f5f5f5;
        }}
        .header {{
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 10px;
            margin-bottom: 30px;
        }}
        .stats {{
            display: flex;
            gap: 20px;
            margin: 20px 0;
        }}
        .stat-card {{
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            flex: 1;
        }}
        .stat-value {{
            font-size: 2em;
            font-weight: bold;
        }}
        .stat-label {{
            color: #666;
            font-size: 0.9em;
        }}
        .evidence {{
            margin: 10px 0;
        }}
        .evidence img {{
            border: 1px solid #ddd;
            border-radius: 4px;
        }}
        .test-result {{
            margin-bottom: 20px;
        }}
    </style>
</head>
<body>
    <div class="container-fluid">
        <div class="header">
            <h1>Test Execution Report</h1>
            <p class="mb-0">Run ID: {run_id} | Test Intent: {test_intent}</p>
            <p class="mb-0">Started: {started_at} | Completed: {completed_at} | Duration: {duration}</p>
        </div>
        
        <div class="stats">
            <div class="stat-card">
                <div class="stat-value text-primary">{total_tests}</div>
                <div class="stat-label">Total Tests</div>
            </div>
            <div class="stat-card">
                <div class="stat-value text-success">{passed}</div>
                <div class="stat-label">Passed</div>
            </div>
            <div class="stat-card">
                <div class="stat-value text-danger">{failed}</div>
                <div class="stat-label">Failed</div>
            </div>
            <div class="stat-card">
                <div class="stat-value text-warning">{skipped}</div>
                <div class="stat-label">Skipped</div>
            </div>
        </div>
        
        {discovery_html}
        
        <div class="card">
            <div class="card-header">
                <h5>Test Results</h5>
            </div>
            <div class="card-body">
                {tests_html if tests_html else "<p>No tests executed.</p>"}
            </div>
        </div>
    </div>
    
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>
"""
        
        return html


    def generate_allure_report(
        self,
        execution_id: str,
        execution_name: str,
        execution_result: Dict[str, Any],
        artifacts_path: str,
        base_url: str,
        environment: str
    ) -> str:
        """
        Generate Allure-style HTML report for test execution.
        
        Args:
            execution_id: Execution identifier
            execution_name: Name of the execution
            execution_result: Test execution results
            artifacts_path: Path to artifacts directory
            base_url: Base URL tested
            environment: Environment name
            
        Returns:
            Path to generated HTML report
        """
        try:
            artifacts_dir = Path(artifacts_path)
            artifacts_dir.mkdir(parents=True, exist_ok=True)
            
            report_file = artifacts_dir / "allure-report.html"
            
            report_data = execution_result.get("report", {})
            tests = report_data.get("tests", [])
            
            # Calculate statistics
            total = report_data.get("total_tests", len(tests))
            passed = report_data.get("passed", 0)
            failed = report_data.get("failed", 0)
            skipped = report_data.get("skipped", 0)
            duration = sum(t.get("duration_ms", 0) for t in tests) / 1000.0
            
            # Generate test cases HTML
            tests_html = ""
            for idx, test in enumerate(tests):
                test_id = test.get("test_id", test.get("id", f"TEST-{idx:03d}"))
                test_name = test.get("name", "Unknown Test")
                test_status = test.get("status", "unknown")
                test_duration = test.get("duration_ms", 0) / 1000.0
                test_error = test.get("error")
                test_steps = test.get("steps", [])
                test_evidence = test.get("evidence", [])
                
                # Status badge
                status_badge = {
                    "passed": '<span class="status-badge passed">✓ PASSED</span>',
                    "failed": '<span class="status-badge failed">✗ FAILED</span>',
                    "skipped": '<span class="status-badge skipped">⊘ SKIPPED</span>',
                    "running": '<span class="status-badge running">⏳ RUNNING</span>'
                }.get(test_status, f'<span class="status-badge unknown">{test_status.upper()}</span>')
                
                # Steps HTML with evidence
                steps_html = ""
                for step_idx, step in enumerate(test_steps):
                    step_status = step.get("status", "unknown")
                    step_action = step.get("action", step if isinstance(step, str) else "execute")
                    step_description = step.get("description", step_action)
                    if isinstance(step, str):
                        step_description = step
                    step_duration = step.get("duration_ms", 0) / 1000.0
                    step_error = step.get("error")
                    step_details = step.get("details", {})
                    step_evidence = step.get("evidence", [])
                    step_ui_observations = step.get("ui_observations", [])
                    step_network_errors = step.get("network_errors", [])
                    step_network_info = step.get("network_info", {})
                    
                    step_status_icon = {
                        "passed": "✓",
                        "failed": "✗",
                        "skipped": "⊘",
                        "running": "⏳"
                    }.get(step_status, "○")
                    
                    step_status_class = {
                        "passed": "step-passed",
                        "failed": "step-failed",
                        "skipped": "step-skipped"
                    }.get(step_status, "step-unknown")
                    
                    # Step error with UI and network observations
                    step_error_html = ""
                    if step_error:
                        step_error_html = f'<div class="step-error"><strong>Error:</strong> {step_error}</div>'
                    
                    # UI Observations
                    ui_obs_html = ""
                    if step_ui_observations:
                        ui_obs_html = '<div class="step-ui-observations"><strong>UI Observations:</strong><ul>'
                        for obs in step_ui_observations:
                            obs_msg = obs.get("message", str(obs))
                            ui_obs_html += f'<li>{obs_msg}</li>'
                        ui_obs_html += '</ul></div>'
                    
                    # Network Errors
                    network_errors_html = ""
                    if step_network_errors:
                        network_errors_html = '<div class="step-network-errors"><strong>Network API Errors:</strong><ul>'
                        for err in step_network_errors:
                            network_errors_html += f'<li>{err}</li>'
                        network_errors_html += '</ul></div>'
                    
                    # Step details
                    step_details_html = ""
                    if step_details:
                        step_details_html = f'<div class="step-details"><strong>Details:</strong><pre>{json.dumps(step_details, indent=2)}</pre></div>'
                    
                    # Step evidence (screenshots)
                    step_evidence_html = ""
                    if step_evidence:
                        step_evidence_html = '<div class="step-evidence"><strong>📷 Evidence (Screenshots):</strong><div class="evidence-grid">'
                        for ev in step_evidence:
                            ev_path = ev if isinstance(ev, str) else ev.get("path", "")
                            if ev_path:
                                # Get relative path for HTML
                                ev_name = Path(ev_path).name
                                # Try to find the actual file path
                                artifacts_dir = Path(artifacts_path)
                                # Handle both relative and absolute paths
                                if Path(ev_path).is_absolute():
                                    ev_full_path = Path(ev_path)
                                else:
                                    ev_full_path = artifacts_dir / ev_path
                                
                                # Also try screenshots subdirectory
                                if not ev_full_path.exists():
                                    ev_full_path = artifacts_dir / "screenshots" / ev_name
                                
                                if ev_full_path.exists():
                                    # Use the artifact endpoint URL for HTML
                                    rel_path = str(ev_full_path.relative_to(artifacts_dir))
                                    # Use the execution artifact endpoint (execution_id is available in scope)
                                    artifact_url = f"/runs/executions/{execution_id}/artifacts/{rel_path}"
                                    step_evidence_html += f'<div class="evidence-item"><img src="{artifact_url}" alt="Step Screenshot {step_idx + 1}" onclick="window.open(this.src, \'_blank\')" title="Click to view full size"><br><small>{ev_name}</small></div>'
                                else:
                                    # Still show the path even if file not found (for debugging)
                                    step_evidence_html += f'<div class="evidence-item"><small style="color: #999;">Screenshot: {ev_name} (not found)</small></div>'
                        step_evidence_html += '</div></div>'
                    
                    steps_html += f"""
                    <div class="test-step {step_status_class}">
                        <div class="step-header">
                            <span class="step-number">Step {step_idx + 1}</span>
                            <span class="step-icon">{step_status_icon}</span>
                            <span class="step-action">{step_description[:100]}</span>
                            <span class="step-duration">{step_duration:.2f}s</span>
                        </div>
                        {step_error_html}
                        {ui_obs_html}
                        {network_errors_html}
                        {step_details_html}
                        {step_evidence_html}
                    </div>
                    """
                
                # Evidence HTML (test-level evidence)
                evidence_html = ""
                if test_evidence:
                    evidence_html = '<div class="test-evidence"><h4>📷 Test Evidence:</h4><div class="evidence-grid">'
                    for ev in test_evidence:
                        ev_path = ev.get("path", "") if isinstance(ev, dict) else str(ev)
                        if ev_path:
                            ev_name = Path(ev_path).name
                            artifacts_dir = Path(artifacts_path)
                            # Try to find the file
                            ev_full_path = artifacts_dir / ev_path
                            if not ev_full_path.exists():
                                ev_full_path = artifacts_dir / "screenshots" / ev_name
                            
                            if ev_full_path.exists():
                                rel_path = str(ev_full_path.relative_to(artifacts_dir))
                                artifact_url = f"/runs/executions/{execution_id}/artifacts/{rel_path}"
                                if ev_path.endswith(('.png', '.jpg', '.jpeg')):
                                    evidence_html += f'<div class="evidence-item"><img src="{artifact_url}" alt="Screenshot" onclick="window.open(this.src, \'_blank\')"></div>'
                                elif ev_path.endswith(('.mp4', '.webm')):
                                    evidence_html += f'<div class="evidence-item"><video controls><source src="{artifact_url}"></video></div>'
                    evidence_html += '</div></div>'
                
                error_html = f'<div class="test-error"><strong>Error:</strong> {test_error}</div>' if test_error else ""
                
                tests_html += f"""
                <div class="test-case" data-status="{test_status}">
                    <div class="test-header">
                        <div class="test-title">
                            <h3>{test_name}</h3>
                            <span class="test-id">{test_id}</span>
                        </div>
                        <div class="test-meta">
                            {status_badge}
                            <span class="test-duration">{test_duration:.2f}s</span>
                        </div>
                    </div>
                    {error_html}
                    <div class="test-steps">
                        <h4>Execution Steps:</h4>
                        {steps_html if steps_html else '<div class="no-steps">No steps recorded</div>'}
                    </div>
                    {evidence_html}
                </div>
                """
            
            # Generate HTML
            html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Allure Report - {execution_name}</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: #f5f5f5;
            color: #333;
            line-height: 1.6;
        }}
        
        .header {{
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }}
        
        .header h1 {{
            font-size: 28px;
            margin-bottom: 10px;
        }}
        
        .header-info {{
            display: flex;
            gap: 30px;
            margin-top: 15px;
            font-size: 14px;
            opacity: 0.9;
        }}
        
        .stats-container {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            padding: 30px;
        }}
        
        .stat-card {{
            background: white;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            text-align: center;
        }}
        
        .stat-value {{
            font-size: 36px;
            font-weight: bold;
            margin-bottom: 5px;
        }}
        
        .stat-label {{
            color: #666;
            font-size: 14px;
        }}
        
        .stat-value.total {{ color: #667eea; }}
        .stat-value.passed {{ color: #10b981; }}
        .stat-value.failed {{ color: #ef4444; }}
        .stat-value.skipped {{ color: #f59e0b; }}
        
        .tests-container {{
            padding: 0 30px 30px;
        }}
        
        .test-case {{
            background: white;
            border-radius: 8px;
            margin-bottom: 20px;
            padding: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            border-left: 4px solid #ddd;
        }}
        
        .test-case[data-status="passed"] {{
            border-left-color: #10b981;
        }}
        
        .test-case[data-status="failed"] {{
            border-left-color: #ef4444;
        }}
        
        .test-case[data-status="skipped"] {{
            border-left-color: #f59e0b;
        }}
        
        .test-header {{
            display: flex;
            justify-content: space-between;
            align-items: start;
            margin-bottom: 15px;
        }}
        
        .test-title h3 {{
            font-size: 18px;
            margin-bottom: 5px;
        }}
        
        .test-id {{
            font-size: 12px;
            color: #666;
            font-family: monospace;
        }}
        
        .test-meta {{
            display: flex;
            align-items: center;
            gap: 10px;
        }}
        
        .status-badge {{
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 600;
        }}
        
        .status-badge.passed {{
            background: #d1fae5;
            color: #065f46;
        }}
        
        .status-badge.failed {{
            background: #fee2e2;
            color: #991b1b;
        }}
        
        .status-badge.skipped {{
            background: #fef3c7;
            color: #92400e;
        }}
        
        .test-duration {{
            color: #666;
            font-size: 14px;
        }}
        
        .test-error {{
            background: #fee2e2;
            color: #991b1b;
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 15px;
        }}
        
        .test-steps {{
            margin-top: 20px;
        }}
        
        .test-steps h4 {{
            font-size: 14px;
            color: #666;
            margin-bottom: 10px;
        }}
        
        .test-step {{
            padding: 12px;
            margin-bottom: 8px;
            border-radius: 6px;
            border-left: 3px solid #ddd;
        }}
        
        .test-step.step-passed {{
            background: #f0fdf4;
            border-left-color: #10b981;
        }}
        
        .test-step.step-failed {{
            background: #fef2f2;
            border-left-color: #ef4444;
        }}
        
        .test-step.step-skipped {{
            background: #fffbeb;
            border-left-color: #f59e0b;
        }}
        
        .step-header {{
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 10px;
        }}
        
        .step-number {{
            background: #667eea;
            color: white;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
        }}
        
        .step-icon {{
            font-weight: bold;
            font-size: 18px;
        }}
        
        .step-action {{
            flex: 1;
            font-weight: 500;
            font-size: 14px;
        }}
        
        .step-duration {{
            color: #666;
            font-size: 12px;
        }}
        
        .step-error {{
            margin-top: 10px;
            padding: 10px;
            background: #fee2e2;
            color: #991b1b;
            border-radius: 4px;
            border-left: 3px solid #ef4444;
            font-size: 13px;
        }}
        
        .step-ui-observations {{
            margin-top: 10px;
            padding: 10px;
            background: #fef3c7;
            border-radius: 4px;
            border-left: 3px solid #f59e0b;
        }}
        
        .step-ui-observations strong {{
            display: block;
            margin-bottom: 5px;
            color: #92400e;
        }}
        
        .step-ui-observations ul {{
            margin: 5px 0 0 20px;
            padding: 0;
        }}
        
        .step-ui-observations li {{
            margin: 5px 0;
            font-size: 13px;
            color: #78350f;
        }}
        
        .step-network-errors {{
            margin-top: 10px;
            padding: 10px;
            background: #fee2e2;
            border-radius: 4px;
            border-left: 3px solid #ef4444;
        }}
        
        .step-network-errors strong {{
            display: block;
            margin-bottom: 5px;
            color: #991b1b;
        }}
        
        .step-network-errors ul {{
            margin: 5px 0 0 20px;
            padding: 0;
        }}
        
        .step-network-errors li {{
            margin: 5px 0;
            font-size: 13px;
            color: #7f1d1d;
        }}
        
        .step-evidence {{
            margin-top: 10px;
            padding: 10px;
            background: #f0f9ff;
            border-radius: 4px;
        }}
        
        .step-evidence strong {{
            display: block;
            margin-bottom: 10px;
            color: #0c4a6e;
        }}
        
        .step-evidence .evidence-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 10px;
            margin-top: 10px;
        }}
        
        .step-evidence .evidence-item {{
            text-align: center;
        }}
        
        .step-evidence .evidence-item img {{
            max-width: 100%;
            border-radius: 4px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            cursor: pointer;
            border: 1px solid #ddd;
        }}
        
        .step-evidence .evidence-item img:hover {{
            transform: scale(1.05);
            transition: transform 0.2s;
        }}
        
        .step-evidence .evidence-item small {{
            display: block;
            margin-top: 5px;
            color: #666;
            font-size: 11px;
        }}
        
        .step-details {{
            margin-top: 10px;
            padding: 10px;
            background: #f9fafb;
            border-radius: 4px;
            font-size: 11px;
            font-family: monospace;
            white-space: pre-wrap;
            max-height: 200px;
            overflow-y: auto;
        }}
        
        .step-details strong {{
            display: block;
            margin-bottom: 5px;
            color: #374151;
        }}
        
        .step-details pre {{
            margin: 5px 0 0 0;
            white-space: pre-wrap;
            word-wrap: break-word;
        }}
        
        .test-evidence {{
            margin-top: 20px;
        }}
        
        .test-evidence h4 {{
            font-size: 14px;
            margin-bottom: 10px;
        }}
        
        .evidence-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 10px;
        }}
        
        .evidence-item img {{
            width: 100%;
            border-radius: 4px;
            cursor: pointer;
            border: 1px solid #ddd;
        }}
        
        .evidence-item video {{
            width: 100%;
            border-radius: 4px;
        }}
        
        .no-steps {{
            color: #999;
            font-style: italic;
            padding: 20px;
            text-align: center;
        }}
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 Allure Test Report</h1>
        <div class="header-info">
            <div><strong>Execution:</strong> {execution_name}</div>
            <div><strong>Environment:</strong> {environment}</div>
            <div><strong>Base URL:</strong> {base_url}</div>
            <div><strong>Duration:</strong> {duration:.2f}s</div>
        </div>
    </div>
    
    <div class="stats-container">
        <div class="stat-card">
            <div class="stat-value total">{total}</div>
            <div class="stat-label">Total Tests</div>
        </div>
        <div class="stat-card">
            <div class="stat-value passed">{passed}</div>
            <div class="stat-label">Passed</div>
        </div>
        <div class="stat-card">
            <div class="stat-value failed">{failed}</div>
            <div class="stat-label">Failed</div>
        </div>
        <div class="stat-card">
            <div class="stat-value skipped">{skipped}</div>
            <div class="stat-label">Skipped</div>
        </div>
    </div>
    
    <div class="tests-container">
        <h2 style="margin-bottom: 20px; padding: 0 10px;">Test Cases</h2>
        {tests_html if tests_html else '<div class="test-case"><p>No tests executed</p></div>'}
    </div>
    
    <script>
        // Filter tests by status
        function filterTests(status) {{
            const tests = document.querySelectorAll('.test-case');
            tests.forEach(test => {{
                if (status === 'all' || test.dataset.status === status) {{
                    test.style.display = 'block';
                }} else {{
                    test.style.display = 'none';
                }}
            }});
        }}
    </script>
</body>
</html>
"""
            
            with open(report_file, "w", encoding="utf-8") as f:
                f.write(html_content)
            
            logger.info(f"[{execution_id}] Allure-style report generated: {report_file}")
            return str(report_file)
            
        except Exception as e:
            logger.error(f"[{execution_id}] Failed to generate Allure report: {e}", exc_info=True)
            raise


# Global report generator instance
_report_generator = ReportGenerator()


def get_report_generator() -> ReportGenerator:
    """Get global report generator instance."""
    return _report_generator
