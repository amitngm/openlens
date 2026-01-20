"""
HTML Report Generator - Creates self-contained HTML reports from JSON test reports.

Reads existing JSON reports and generates human-readable HTML with:
- Run metadata
- Discovery summary (if available)
- Test summary with pass/fail counts
- Detailed failure analysis with screenshots/videos
- Network issues (4xx/5xx/slow requests)
"""

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional
from urllib.parse import quote

logger = logging.getLogger(__name__)


class HTMLReportGenerator:
    """Generates HTML reports from JSON test reports."""
    
    def __init__(self, data_dir: Path = None):
        """
        Initialize HTML report generator.
        
        Args:
            data_dir: Base data directory (default: /data)
        """
        import os
        self.data_dir = data_dir or Path(os.getenv("DATA_DIR", "/data"))
    
    def find_report_file(self, run_id: str) -> Optional[Path]:
        """
        Find JSON report file for a run_id.
        
        Searches in multiple locations:
        1. /data/{discovery_id}/run_{run_id}/report.json
        2. /data/{run_id}/report.json
        3. /data/artifacts/{run_id}/reports/report.json
        """
        # Search pattern 1: discovery-based runs
        for discovery_dir in self.data_dir.iterdir():
            if discovery_dir.is_dir():
                run_dir = discovery_dir / f"run_{run_id}"
                report_file = run_dir / "report.json"
                if report_file.exists():
                    return report_file
        
        # Search pattern 2: direct run_id
        report_file = self.data_dir / run_id / "report.json"
        if report_file.exists():
            return report_file
        
        # Search pattern 3: artifacts directory
        report_file = self.data_dir / "artifacts" / run_id / "reports" / "report.json"
        if report_file.exists():
            return report_file
        
        return None
    
    def load_report(self, run_id: str) -> Optional[Dict[str, Any]]:
        """Load JSON report for a run."""
        report_file = self.find_report_file(run_id)
        if not report_file:
            return None
        
        with open(report_file, 'r') as f:
            return json.load(f)
    
    def load_discovery(self, discovery_id: str) -> Optional[Dict[str, Any]]:
        """Load discovery data if available."""
        discovery_file = self.data_dir / discovery_id / "discovery.json"
        if discovery_file.exists():
            with open(discovery_file, 'r') as f:
                return json.load(f)
        return None
    
    def extract_network_issues(self, report: Dict[str, Any]) -> Dict[str, List[Dict]]:
        """
        Extract network issues from test results.
        
        Returns:
            {
                "errors_4xx": [...],
                "errors_5xx": [...],
                "slow_requests": [...]  # >3 seconds
            }
        """
        issues = {
            "errors_4xx": [],
            "errors_5xx": [],
            "slow_requests": []
        }
        
        for test_result in report.get("test_results", []):
            test_id = test_result.get("test_id", "unknown")
            test_name = test_result.get("name", "Unknown Test")
            
            for step in test_result.get("steps", []):
                # Check API response status codes
                response = step.get("response") or step.get("details", {}).get("response")
                if response:
                    status = response.get("status_code") or response.get("status")
                    if status:
                        if 400 <= status < 500:
                            issues["errors_4xx"].append({
                                "test_id": test_id,
                                "test_name": test_name,
                                "status": status,
                                "url": response.get("url", "unknown"),
                                "step": step.get("action", "unknown"),
                                "error": step.get("error")
                            })
                        elif status >= 500:
                            issues["errors_5xx"].append({
                                "test_id": test_id,
                                "test_name": test_name,
                                "status": status,
                                "url": response.get("url", "unknown"),
                                "step": step.get("action", "unknown"),
                                "error": step.get("error")
                            })
                
                # Check for slow requests (>3000ms)
                duration = step.get("duration_ms", 0)
                if duration > 3000:
                    issues["slow_requests"].append({
                        "test_id": test_id,
                        "test_name": test_name,
                        "duration_ms": duration,
                        "step": step.get("action", "unknown"),
                        "url": step.get("details", {}).get("url", "unknown")
                    })
        
        return issues
    
    def generate_html(self, run_id: str) -> Optional[str]:
        """
        Generate HTML report for a run.
        
        Args:
            run_id: Test run identifier
            
        Returns:
            HTML content as string, or None if report not found
        """
        report = self.load_report(run_id)
        if not report:
            return None
        
        report_file = self.find_report_file(run_id)
        if not report_file:
            return None
        
        # Determine artifact base path (relative to report file)
        artifacts_dir = Path(report.get("artifacts_dir", report_file.parent))
        report_dir = report_file.parent
        artifact_base = artifacts_dir.relative_to(report_dir) if artifacts_dir.is_absolute() else artifacts_dir
        
        # Load discovery if available
        discovery = None
        discovery_id = report.get("discovery_id")
        if discovery_id:
            discovery = self.load_discovery(discovery_id)
        
        # Extract network issues
        network_issues = self.extract_network_issues(report)
        
        # Generate HTML
        html = self._render_html(report, discovery, network_issues, artifact_base, report_dir)
        
        return html
    
    def save_html(self, run_id: str, output_path: Optional[Path] = None) -> Optional[Path]:
        """
        Generate and save HTML report.
        
        Args:
            run_id: Test run identifier
            output_path: Optional custom output path (default: next to report.json)
            
        Returns:
            Path to saved HTML file, or None if failed
        """
        html = self.generate_html(run_id)
        if not html:
            return None
        
        report_file = self.find_report_file(run_id)
        if not report_file:
            return None
        
        if output_path:
            html_path = output_path
        else:
            html_path = report_file.parent / "report.html"
        
        html_path.write_text(html, encoding='utf-8')
        logger.info(f"Generated HTML report: {html_path}")
        
        return html_path
    
    def _render_html(
        self,
        report: Dict[str, Any],
        discovery: Optional[Dict[str, Any]],
        network_issues: Dict[str, List[Dict]],
        artifact_base: Path,
        report_dir: Path
    ) -> str:
        """Render HTML content."""
        
        # Format timestamps
        started_at = report.get("started_at", "")
        completed_at = report.get("completed_at", "")
        duration = ""
        if started_at and completed_at:
            try:
                start = datetime.fromisoformat(started_at.replace('Z', '+00:00'))
                end = datetime.fromisoformat(completed_at.replace('Z', '+00:00'))
                delta = end - start
                duration = f"{delta.total_seconds():.1f}s"
            except:
                pass
        
        # Test results
        test_results = report.get("test_results", [])
        failed_tests = [t for t in test_results if t.get("status") in ["failed", "error"]]
        passed_tests = [t for t in test_results if t.get("status") == "passed"]
        
        # Summary stats
        summary = report.get("summary", {})
        total = summary.get("total", 0)
        passed = summary.get("passed", 0)
        failed = summary.get("failed", 0)
        skipped = summary.get("skipped", 0)
        pass_rate = summary.get("pass_rate", "0%")
        
        # Build HTML
        html_parts = [
            self._html_header(report.get("run_id", "unknown")),
            self._html_metadata(report, duration),
            self._html_discovery_summary(discovery),
            self._html_test_summary(summary, total, passed, failed, skipped, pass_rate),
            self._html_failures(failed_tests, artifact_base),
            self._html_network_issues(network_issues),
            self._html_test_results_table(test_results, artifact_base),
            self._html_footer()
        ]
        
        return "\n".join(html_parts)
    
    def _html_header(self, run_id: str) -> str:
        """Generate HTML header with embedded CSS and JS."""
        return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test Report - {run_id}</title>
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
            padding: 20px;
        }}
        
        .container {{
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            overflow: hidden;
        }}
        
        header {{
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }}
        
        header h1 {{
            font-size: 2em;
            margin-bottom: 10px;
        }}
        
        .section {{
            padding: 30px;
            border-bottom: 1px solid #eee;
        }}
        
        .section:last-child {{
            border-bottom: none;
        }}
        
        .section h2 {{
            font-size: 1.5em;
            margin-bottom: 20px;
            color: #333;
            border-bottom: 2px solid #667eea;
            padding-bottom: 10px;
        }}
        
        .metadata-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-top: 20px;
        }}
        
        .metadata-item {{
            background: #f9f9f9;
            padding: 15px;
            border-radius: 4px;
        }}
        
        .metadata-item label {{
            font-weight: 600;
            color: #666;
            display: block;
            margin-bottom: 5px;
            font-size: 0.9em;
        }}
        
        .metadata-item value {{
            display: block;
            color: #333;
            font-size: 1.1em;
        }}
        
        .summary-cards {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-top: 20px;
        }}
        
        .summary-card {{
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            color: white;
        }}
        
        .summary-card.total {{
            background: #667eea;
        }}
        
        .summary-card.passed {{
            background: #10b981;
        }}
        
        .summary-card.failed {{
            background: #ef4444;
        }}
        
        .summary-card.skipped {{
            background: #f59e0b;
        }}
        
        .summary-card .number {{
            font-size: 2.5em;
            font-weight: bold;
            margin-bottom: 5px;
        }}
        
        .summary-card .label {{
            font-size: 0.9em;
            opacity: 0.9;
        }}
        
        .test-table {{
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }}
        
        .test-table th {{
            background: #f9f9f9;
            padding: 12px;
            text-align: left;
            font-weight: 600;
            border-bottom: 2px solid #ddd;
        }}
        
        .test-table td {{
            padding: 12px;
            border-bottom: 1px solid #eee;
        }}
        
        .test-table tr:hover {{
            background: #f9f9f9;
        }}
        
        .status-badge {{
            display: inline-block;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 0.85em;
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
        
        .status-badge.error {{
            background: #fee2e2;
            color: #991b1b;
        }}
        
        .failure-details {{
            background: #fef2f2;
            border-left: 4px solid #ef4444;
            padding: 20px;
            margin: 20px 0;
            border-radius: 4px;
        }}
        
        .failure-details h3 {{
            color: #991b1b;
            margin-bottom: 15px;
        }}
        
        .steps-list {{
            margin: 15px 0;
        }}
        
        .step-item {{
            padding: 10px;
            margin: 5px 0;
            background: white;
            border-radius: 4px;
            border-left: 3px solid #ddd;
        }}
        
        .step-item.failed {{
            border-left-color: #ef4444;
            background: #fee2e2;
        }}
        
        .step-item.passed {{
            border-left-color: #10b981;
        }}
        
        .screenshot-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 15px;
            margin-top: 15px;
        }}
        
        .screenshot-item {{
            position: relative;
            border: 1px solid #ddd;
            border-radius: 4px;
            overflow: hidden;
            cursor: pointer;
        }}
        
        .screenshot-item img {{
            width: 100%;
            height: auto;
            display: block;
        }}
        
        .screenshot-item .caption {{
            padding: 8px;
            background: #f9f9f9;
            font-size: 0.85em;
            color: #666;
        }}
        
        .network-issues {{
            margin-top: 20px;
        }}
        
        .issue-group {{
            margin: 20px 0;
            padding: 15px;
            background: #fef2f2;
            border-radius: 4px;
            border-left: 4px solid #ef4444;
        }}
        
        .issue-group h4 {{
            color: #991b1b;
            margin-bottom: 10px;
        }}
        
        .issue-item {{
            padding: 10px;
            margin: 5px 0;
            background: white;
            border-radius: 4px;
        }}
        
        .expandable {{
            cursor: pointer;
        }}
        
        .expandable:hover {{
            background: #f9f9f9;
        }}
        
        .expandable-content {{
            display: none;
            margin-top: 10px;
            padding: 15px;
            background: #f9f9f9;
            border-radius: 4px;
        }}
        
        .expandable-content.expanded {{
            display: block;
        }}
        
        .modal {{
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.9);
            cursor: pointer;
        }}
        
        .modal.active {{
            display: flex;
            align-items: center;
            justify-content: center;
        }}
        
        .modal img {{
            max-width: 90%;
            max-height: 90%;
            border-radius: 4px;
        }}
        
        footer {{
            padding: 20px;
            text-align: center;
            color: #666;
            background: #f9f9f9;
        }}
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🧪 Test Execution Report</h1>
            <p>Run ID: {run_id}</p>
        </header>"""
    
    def _html_metadata(self, report: Dict[str, Any], duration: str) -> str:
        """Generate metadata section."""
        source_url = report.get("source_url", "N/A")
        discovery_id = report.get("discovery_id", "N/A")
        status = report.get("status", "unknown")
        started_at = report.get("started_at", "N/A")
        completed_at = report.get("completed_at", "N/A")
        
        status_badge_class = {
            "completed": "passed",
            "failed": "failed",
            "running": "skipped"
        }.get(status, "skipped")
        
        return f"""
        <div class="section">
            <h2>Run Metadata</h2>
            <div class="metadata-grid">
                <div class="metadata-item">
                    <label>Status</label>
                    <value><span class="status-badge {status_badge_class}">{status.upper()}</span></value>
                </div>
                <div class="metadata-item">
                    <label>Source URL</label>
                    <value>{self._escape_html(source_url)}</value>
                </div>
                <div class="metadata-item">
                    <label>Discovery ID</label>
                    <value>{self._escape_html(discovery_id)}</value>
                </div>
                <div class="metadata-item">
                    <label>Started At</label>
                    <value>{self._format_timestamp(started_at)}</value>
                </div>
                <div class="metadata-item">
                    <label>Completed At</label>
                    <value>{self._format_timestamp(completed_at)}</value>
                </div>
                <div class="metadata-item">
                    <label>Duration</label>
                    <value>{duration or "N/A"}</value>
                </div>
            </div>
        </div>"""
    
    def _html_discovery_summary(self, discovery: Optional[Dict[str, Any]]) -> str:
        """Generate discovery summary section."""
        if not discovery:
            return ""
        
        summary = discovery.get("summary", {})
        modules = discovery.get("modules", [])
        pages = discovery.get("pages", [])
        
        return f"""
        <div class="section">
            <h2>Discovery Summary</h2>
            <div class="metadata-grid">
                <div class="metadata-item">
                    <label>Total Modules</label>
                    <value>{summary.get("total_modules", 0)}</value>
                </div>
                <div class="metadata-item">
                    <label>Total Pages</label>
                    <value>{summary.get("total_pages", len(pages))}</value>
                </div>
                <div class="metadata-item">
                    <label>Total Actions</label>
                    <value>{summary.get("total_actions", 0)}</value>
                </div>
                <div class="metadata-item">
                    <label>API Endpoints</label>
                    <value>{summary.get("total_apis", 0)}</value>
                </div>
            </div>
        </div>"""
    
    def _html_test_summary(self, summary: Dict, total: int, passed: int, failed: int, skipped: int, pass_rate: str) -> str:
        """Generate test summary section."""
        return f"""
        <div class="section">
            <h2>Test Summary</h2>
            <div class="summary-cards">
                <div class="summary-card total">
                    <div class="number">{total}</div>
                    <div class="label">Total Tests</div>
                </div>
                <div class="summary-card passed">
                    <div class="number">{passed}</div>
                    <div class="label">Passed</div>
                </div>
                <div class="summary-card failed">
                    <div class="number">{failed}</div>
                    <div class="label">Failed</div>
                </div>
                <div class="summary-card skipped">
                    <div class="number">{skipped}</div>
                    <div class="label">Skipped</div>
                </div>
            </div>
            <div style="margin-top: 20px; text-align: center; font-size: 1.2em; font-weight: 600; color: #667eea;">
                Pass Rate: {pass_rate}
            </div>
        </div>"""
    
    def _html_failures(self, failed_tests: List[Dict], artifact_base: Path) -> str:
        """Generate failures section with screenshots."""
        if not failed_tests:
            return ""
        
        failures_html = []
        for test in failed_tests:
            test_id = test.get("test_id", "unknown")
            test_name = test.get("name", "Unknown Test")
            error = test.get("error", "No error message")
            steps = test.get("steps", [])
            evidence = test.get("evidence", [])
            
            # Filter failed steps
            failed_steps = [s for s in steps if s.get("status") == "failed"]
            
            # Screenshots
            screenshots = [e for e in evidence if e.endswith(('.png', '.jpg', '.jpeg'))]
            
            steps_html = ""
            for step in steps:
                step_status = step.get("status", "unknown")
                step_action = step.get("action", "unknown")
                step_error = step.get("error", "")
                step_class = "step-item " + step_status
                
                steps_html += f"""
                <div class="{step_class}">
                    <strong>{self._escape_html(step_action)}</strong>
                    {f'<span class="status-badge {step_status}">{step_status.upper()}</span>' if step_status else ''}
                    {f'<div style="margin-top: 5px; color: #991b1b;">{self._escape_html(step_error)}</div>' if step_error else ''}
                </div>"""
            
            screenshots_html = ""
            if screenshots:
                screenshots_html = '<div class="screenshot-grid">'
                for screenshot in screenshots:
                    screenshot_path = artifact_base / screenshot
                    screenshots_html += f"""
                    <div class="screenshot-item" onclick="openModal('{self._escape_js(str(screenshot_path))}')">
                        <img src="{self._escape_html(str(screenshot_path))}" alt="{self._escape_html(screenshot)}" loading="lazy">
                        <div class="caption">{self._escape_html(screenshot)}</div>
                    </div>"""
                screenshots_html += '</div>'
            
            failures_html.append(f"""
            <div class="failure-details">
                <h3>❌ {self._escape_html(test_name)} ({test_id})</h3>
                <p><strong>Error:</strong> {self._escape_html(error)}</p>
                <div class="steps-list">
                    <strong>Steps:</strong>
                    {steps_html}
                </div>
                {screenshots_html}
            </div>""")
        
        return f"""
        <div class="section">
            <h2>Failures ({len(failed_tests)})</h2>
            {''.join(failures_html)}
        </div>"""
    
    def _html_network_issues(self, network_issues: Dict[str, List[Dict]]) -> str:
        """Generate network issues section."""
        issues_4xx = network_issues.get("errors_4xx", [])
        issues_5xx = network_issues.get("errors_5xx", [])
        slow_requests = network_issues.get("slow_requests", [])
        
        if not (issues_4xx or issues_5xx or slow_requests):
            return ""
        
        issues_html = []
        
        if issues_4xx:
            issues_html.append(f"""
            <div class="issue-group">
                <h4>4xx Client Errors ({len(issues_4xx)})</h4>
                {self._render_issue_list(issues_4xx)}
            </div>""")
        
        if issues_5xx:
            issues_html.append(f"""
            <div class="issue-group">
                <h4>5xx Server Errors ({len(issues_5xx)})</h4>
                {self._render_issue_list(issues_5xx)}
            </div>""")
        
        if slow_requests:
            issues_html.append(f"""
            <div class="issue-group">
                <h4>Slow Requests (>3s) ({len(slow_requests)})</h4>
                {self._render_slow_requests(slow_requests)}
            </div>""")
        
        return f"""
        <div class="section">
            <h2>Network Issues</h2>
            {''.join(issues_html)}
        </div>"""
    
    def _render_issue_list(self, issues: List[Dict]) -> str:
        """Render list of network issues."""
        items = []
        for issue in issues:
            items.append(f"""
            <div class="issue-item">
                <strong>{self._escape_html(issue.get("test_name", "Unknown"))}</strong>
                <br>
                <span style="color: #666;">Status: {issue.get("status")}</span>
                <br>
                <span style="color: #666; font-size: 0.9em;">URL: {self._escape_html(issue.get("url", "unknown"))}</span>
                {f'<br><span style="color: #991b1b;">Error: {self._escape_html(issue.get("error", ""))}</span>' if issue.get("error") else ''}
            </div>""")
        return ''.join(items)
    
    def _render_slow_requests(self, requests: List[Dict]) -> str:
        """Render slow requests list."""
        items = []
        for req in requests:
            duration = req.get("duration_ms", 0)
            items.append(f"""
            <div class="issue-item">
                <strong>{self._escape_html(req.get("test_name", "Unknown"))}</strong>
                <br>
                <span style="color: #666;">Duration: {duration}ms</span>
                <br>
                <span style="color: #666; font-size: 0.9em;">Step: {self._escape_html(req.get("step", "unknown"))}</span>
            </div>""")
        return ''.join(items)
    
    def _html_test_results_table(self, test_results: List[Dict], artifact_base: Path) -> str:
        """Generate test results table."""
        rows = []
        for test in test_results:
            test_id = test.get("test_id", "unknown")
            test_name = test.get("name", "Unknown")
            status = test.get("status", "unknown")
            duration = test.get("duration_ms", 0)
            steps_count = len(test.get("steps", []))
            evidence_count = len(test.get("evidence", []))
            
            status_badge = f'<span class="status-badge {status}">{status.upper()}</span>'
            
            rows.append(f"""
            <tr class="expandable" onclick="toggleDetails('{test_id}')">
                <td>{self._escape_html(test_id)}</td>
                <td>{self._escape_html(test_name)}</td>
                <td>{status_badge}</td>
                <td>{duration}ms</td>
                <td>{steps_count}</td>
                <td>{evidence_count}</td>
            </tr>
            <tr id="details-{test_id}" class="expandable-content">
                <td colspan="6">
                    {self._render_test_details(test, artifact_base)}
                </td>
            </tr>""")
        
        return f"""
        <div class="section">
            <h2>All Test Results</h2>
            <table class="test-table">
                <thead>
                    <tr>
                        <th>Test ID</th>
                        <th>Name</th>
                        <th>Status</th>
                        <th>Duration</th>
                        <th>Steps</th>
                        <th>Evidence</th>
                    </tr>
                </thead>
                <tbody>
                    {''.join(rows)}
                </tbody>
            </table>
        </div>"""
    
    def _render_test_details(self, test: Dict, artifact_base: Path) -> str:
        """Render detailed test information."""
        steps = test.get("steps", [])
        evidence = test.get("evidence", [])
        
        steps_html = ""
        for i, step in enumerate(steps):
            step_status = step.get("status", "unknown")
            step_action = step.get("action", "unknown")
            step_duration = step.get("duration_ms", 0)
            step_error = step.get("error", "")
            
            steps_html += f"""
            <div class="step-item {step_status}">
                <strong>Step {i+1}: {self._escape_html(step_action)}</strong>
                <span class="status-badge {step_status}">{step_status.upper()}</span>
                <span style="float: right; color: #666;">{step_duration}ms</span>
                {f'<div style="margin-top: 5px; color: #991b1b;">{self._escape_html(step_error)}</div>' if step_error else ''}
            </div>"""
        
        evidence_html = ""
        if evidence:
            evidence_html = "<div style='margin-top: 15px;'><strong>Evidence:</strong><ul>"
            for ev in evidence:
                ev_path = artifact_base / ev
                evidence_html += f"<li><a href='{self._escape_html(str(ev_path))}' target='_blank'>{self._escape_html(ev)}</a></li>"
            evidence_html += "</ul></div>"
        
        return f"""
        <div style="padding: 15px;">
            <h4>Steps:</h4>
            <div class="steps-list">{steps_html}</div>
            {evidence_html}
        </div>"""
    
    def _html_footer(self) -> str:
        """Generate HTML footer with JavaScript."""
        return """
        <footer>
            <p>Generated by QA Agent • Report is self-contained and portable</p>
        </footer>
    </div>
    
    <!-- Modal for full-size images -->
    <div id="imageModal" class="modal" onclick="closeModal()">
        <img id="modalImage" src="" alt="Full size screenshot">
    </div>
    
    <script>
        function toggleDetails(testId) {
            const content = document.getElementById('details-' + testId);
            if (content) {
                content.classList.toggle('expanded');
            }
        }
        
        function openModal(imagePath) {
            const modal = document.getElementById('imageModal');
            const img = document.getElementById('modalImage');
            img.src = imagePath;
            modal.classList.add('active');
        }
        
        function closeModal() {
            const modal = document.getElementById('imageModal');
            modal.classList.remove('active');
        }
        
        // Close modal on Escape key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                closeModal();
            }
        });
    </script>
</body>
</html>"""
    
    def _escape_html(self, text: str) -> str:
        """Escape HTML special characters."""
        if not text:
            return ""
        return (str(text)
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace('"', "&quot;")
                .replace("'", "&#x27;"))
    
    def _escape_js(self, text: str) -> str:
        """Escape JavaScript special characters."""
        if not text:
            return ""
        return (str(text)
                .replace("\\", "\\\\")
                .replace("'", "\\'")
                .replace('"', '\\"')
                .replace("\n", "\\n")
                .replace("\r", "\\r"))
    
    def _format_timestamp(self, timestamp: str) -> str:
        """Format ISO timestamp for display."""
        if not timestamp or timestamp == "N/A":
            return "N/A"
        try:
            dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
            return dt.strftime("%Y-%m-%d %H:%M:%S UTC")
        except:
            return timestamp
