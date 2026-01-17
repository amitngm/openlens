"""
API Test Runner

Executes API test steps with support for:
- Bearer token authentication
- Request/response logging with secret redaction
- Retries with configurable delays
- JSONPath assertions
"""

import re
import json
import time
import logging
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field
from datetime import datetime

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

logger = logging.getLogger(__name__)

# Patterns for secret redaction
SECRET_PATTERNS = [
    re.compile(r'(password|secret|token|api[_-]?key|auth|credential|bearer)', re.I),
]

SECRET_VALUE_PATTERNS = [
    re.compile(r'Bearer\s+[A-Za-z0-9\-_\.]+', re.I),
    re.compile(r'Basic\s+[A-Za-z0-9\+/=]+', re.I),
]


@dataclass
class APIStepResult:
    """Result of an API step execution."""
    status_code: int
    headers: Dict[str, str]
    body: Any
    duration_ms: int
    success: bool
    error: Optional[str] = None
    assertions: List[Dict] = field(default_factory=list)
    extracted: Dict[str, Any] = field(default_factory=dict)


class APIRunner:
    """Executes API test steps."""
    
    def __init__(
        self,
        base_url: str,
        default_headers: Optional[Dict[str, str]] = None,
        bearer_token: Optional[str] = None,
        timeout: int = 30,
        verify_ssl: bool = True
    ):
        self.base_url = base_url.rstrip('/')
        self.default_headers = default_headers or {}
        self.bearer_token = bearer_token
        self.timeout = timeout
        self.verify_ssl = verify_ssl
        self.variables: Dict[str, Any] = {}
        
        # Create session with retry configuration
        self.session = requests.Session()
        retry_strategy = Retry(
            total=0,  # We handle retries manually for better control
            backoff_factor=1,
            status_forcelist=[502, 503, 504]
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        self.session.mount('http://', adapter)
        self.session.mount('https://', adapter)
    
    def execute(
        self,
        method: str,
        url: str,
        headers: Optional[Dict[str, str]] = None,
        body: Optional[Any] = None,
        query_params: Optional[Dict[str, str]] = None,
        expected_status: int = 200,
        assertions: Optional[List[Dict]] = None,
        extract: Optional[Dict[str, str]] = None,
        retries: int = 0,
        retry_delay_ms: int = 1000,
        timeout_ms: Optional[int] = None
    ) -> APIStepResult:
        """
        Execute an API request.
        
        Args:
            method: HTTP method (GET, POST, PUT, PATCH, DELETE)
            url: Request URL (relative or absolute)
            headers: Request headers
            body: Request body (dict for JSON, string otherwise)
            query_params: Query parameters
            expected_status: Expected HTTP status code
            assertions: List of assertions to run
            extract: Dict of variable_name -> jsonpath for extraction
            retries: Number of retries on failure
            retry_delay_ms: Delay between retries
            timeout_ms: Request timeout in milliseconds
        
        Returns:
            APIStepResult with response data and assertion results
        """
        # Build full URL
        full_url = self._build_url(url)
        
        # Build headers
        request_headers = self._build_headers(headers)
        
        # Interpolate variables
        full_url = self._interpolate(full_url)
        request_headers = {k: self._interpolate(v) for k, v in request_headers.items()}
        if query_params:
            query_params = {k: self._interpolate(v) for k, v in query_params.items()}
        if body:
            body = self._interpolate_body(body)
        
        # Execute with retries
        timeout_sec = (timeout_ms or self.timeout * 1000) / 1000
        last_error = None
        result = None
        
        for attempt in range(retries + 1):
            if attempt > 0:
                logger.info(f"Retrying request (attempt {attempt + 1}/{retries + 1})")
                time.sleep(retry_delay_ms / 1000)
            
            start_time = time.time()
            
            try:
                logger.info(
                    f"API Request: {method} {self._redact_url(full_url)}",
                    extra={'headers': self._redact_dict(request_headers)}
                )
                
                response = self.session.request(
                    method=method,
                    url=full_url,
                    headers=request_headers,
                    json=body if isinstance(body, dict) else None,
                    data=body if isinstance(body, str) else None,
                    params=query_params,
                    timeout=timeout_sec,
                    verify=self.verify_ssl
                )
                
                duration_ms = int((time.time() - start_time) * 1000)
                
                # Parse response body
                try:
                    response_body = response.json()
                except (json.JSONDecodeError, ValueError):
                    response_body = response.text
                
                logger.info(
                    f"API Response: {response.status_code} ({duration_ms}ms)",
                    extra={'body': self._redact_dict(response_body) if isinstance(response_body, dict) else response_body[:500]}
                )
                
                # Check expected status
                if response.status_code != expected_status:
                    last_error = f"Expected status {expected_status}, got {response.status_code}"
                    continue
                
                result = APIStepResult(
                    status_code=response.status_code,
                    headers=dict(response.headers),
                    body=response_body,
                    duration_ms=duration_ms,
                    success=True
                )
                break
                
            except requests.RequestException as e:
                duration_ms = int((time.time() - start_time) * 1000)
                last_error = str(e)
                logger.error(f"API Request failed: {last_error}")
        
        if result is None:
            result = APIStepResult(
                status_code=0,
                headers={},
                body=None,
                duration_ms=duration_ms,
                success=False,
                error=last_error
            )
        
        # Run assertions
        if assertions and result.success:
            result.assertions = self._run_assertions(assertions, result)
            if any(not a['passed'] for a in result.assertions):
                result.success = False
                result.error = "Assertions failed"
        
        # Extract variables
        if extract and result.success:
            result.extracted = self._extract_variables(extract, result.body)
            self.variables.update(result.extracted)
        
        return result
    
    def _build_url(self, url: str) -> str:
        """Build full URL from relative or absolute URL."""
        if url.startswith('http://') or url.startswith('https://'):
            return url
        return f"{self.base_url}/{url.lstrip('/')}"
    
    def _build_headers(self, headers: Optional[Dict[str, str]]) -> Dict[str, str]:
        """Build request headers with defaults and auth."""
        result = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            **self.default_headers
        }
        
        if self.bearer_token:
            result['Authorization'] = f'Bearer {self.bearer_token}'
        
        if headers:
            result.update(headers)
        
        return result
    
    def _interpolate(self, value: str) -> str:
        """Interpolate variables in a string."""
        if not isinstance(value, str):
            return value
        
        result = value
        
        # Replace ${variable} patterns
        for match in re.finditer(r'\$\{(\w+)\}', value):
            var_name = match.group(1)
            if var_name in self.variables:
                result = result.replace(match.group(0), str(self.variables[var_name]))
        
        return result
    
    def _interpolate_body(self, body: Any) -> Any:
        """Interpolate variables in request body."""
        if isinstance(body, str):
            return self._interpolate(body)
        elif isinstance(body, dict):
            return {k: self._interpolate_body(v) for k, v in body.items()}
        elif isinstance(body, list):
            return [self._interpolate_body(item) for item in body]
        return body
    
    def _run_assertions(
        self,
        assertions: List[Dict],
        result: APIStepResult
    ) -> List[Dict]:
        """Run assertions against the response."""
        assertion_results = []
        
        for assertion in assertions:
            assertion_result = {
                'type': assertion.get('type'),
                'target': assertion.get('target'),
                'expected': assertion.get('expected'),
                'actual': None,
                'passed': False,
                'message': None
            }
            
            try:
                # Extract actual value
                if assertion['type'] == 'status_code':
                    assertion_result['actual'] = result.status_code
                else:
                    assertion_result['actual'] = self._extract_jsonpath(
                        result.body,
                        assertion.get('target', '')
                    )
                
                # Check assertion
                assertion_result['passed'] = self._check_assertion(
                    assertion['type'],
                    assertion_result['actual'],
                    assertion.get('expected')
                )
                
                assertion_result['message'] = (
                    'Passed' if assertion_result['passed']
                    else assertion.get('message', f"Expected {assertion.get('expected')}, got {assertion_result['actual']}")
                )
                
            except Exception as e:
                assertion_result['message'] = str(e)
            
            assertion_results.append(assertion_result)
        
        return assertion_results
    
    def _check_assertion(
        self,
        assertion_type: str,
        actual: Any,
        expected: Any
    ) -> bool:
        """Check if an assertion passes."""
        if assertion_type == 'equals':
            return actual == expected
        elif assertion_type == 'not_equals':
            return actual != expected
        elif assertion_type == 'contains':
            return expected in str(actual)
        elif assertion_type == 'not_contains':
            return expected not in str(actual)
        elif assertion_type == 'matches':
            return bool(re.match(expected, str(actual)))
        elif assertion_type == 'greater_than':
            return float(actual) > float(expected)
        elif assertion_type == 'less_than':
            return float(actual) < float(expected)
        elif assertion_type == 'exists':
            return actual is not None
        elif assertion_type == 'not_exists':
            return actual is None
        elif assertion_type == 'status_code':
            return actual == expected
        
        return False
    
    def _extract_variables(
        self,
        extract: Dict[str, str],
        body: Any
    ) -> Dict[str, Any]:
        """Extract variables from response body."""
        extracted = {}
        
        for var_name, jsonpath in extract.items():
            try:
                value = self._extract_jsonpath(body, jsonpath)
                extracted[var_name] = value
                logger.info(f"Extracted {var_name}={self._redact_value(var_name, value)}")
            except Exception as e:
                logger.warning(f"Failed to extract {var_name}: {e}")
        
        return extracted
    
    def _extract_jsonpath(self, data: Any, path: str) -> Any:
        """Extract value using JSONPath-like syntax."""
        if not path or not data:
            return None
        
        # Remove leading $. if present
        clean_path = path.lstrip('$').lstrip('.')
        parts = clean_path.split('.')
        
        value = data
        for part in parts:
            # Handle array index: items[0]
            match = re.match(r'^(\w+)\[(\d+)\]$', part)
            if match:
                key, idx = match.groups()
                value = value.get(key, [])[int(idx)] if isinstance(value, dict) else None
            else:
                value = value.get(part) if isinstance(value, dict) else None
            
            if value is None:
                break
        
        return value
    
    def _redact_url(self, url: str) -> str:
        """Redact sensitive query parameters from URL."""
        try:
            from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
            
            parsed = urlparse(url)
            params = parse_qs(parsed.query)
            
            sensitive_params = ['token', 'key', 'apikey', 'api_key', 'secret']
            for param in sensitive_params:
                if param in params:
                    params[param] = ['[REDACTED]']
            
            new_query = urlencode(params, doseq=True)
            return urlunparse(parsed._replace(query=new_query))
        except Exception:
            return url
    
    def _redact_dict(self, data: Any) -> Any:
        """Redact sensitive values from a dictionary."""
        if not isinstance(data, dict):
            return data
        
        redacted = {}
        for key, value in data.items():
            if any(p.search(key) for p in SECRET_PATTERNS):
                redacted[key] = '[REDACTED]'
            elif isinstance(value, dict):
                redacted[key] = self._redact_dict(value)
            elif isinstance(value, str):
                redacted[key] = self._redact_string(value)
            else:
                redacted[key] = value
        
        return redacted
    
    def _redact_string(self, value: str) -> str:
        """Redact sensitive patterns from a string."""
        result = value
        for pattern in SECRET_VALUE_PATTERNS:
            result = pattern.sub('[REDACTED]', result)
        return result
    
    def _redact_value(self, var_name: str, value: Any) -> Any:
        """Redact value if variable name suggests sensitivity."""
        if any(p.search(var_name) for p in SECRET_PATTERNS):
            return '[REDACTED]'
        return value
    
    def set_variable(self, name: str, value: Any):
        """Set a variable for interpolation."""
        self.variables[name] = value
    
    def get_variable(self, name: str) -> Any:
        """Get a variable value."""
        return self.variables.get(name)
    
    def clear_variables(self):
        """Clear all variables."""
        self.variables.clear()
