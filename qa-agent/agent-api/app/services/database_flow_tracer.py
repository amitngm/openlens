"""Database flow tracer - monitors network traffic and traces database operations."""

import asyncio
import json
import logging
import re
from typing import Dict, List, Optional, Any
from datetime import datetime
from urllib.parse import urlparse
import sqlparse

logger = logging.getLogger(__name__)


class DatabaseFlowTracer:
    """Monitor network traffic and trace database operations."""

    # URL patterns that typically indicate database operations
    DB_OPERATION_PATTERNS = {
        "INSERT": [r"/create$", r"/add$", r"/insert$", r"POST.*/api/"],
        "UPDATE": [r"/update/", r"/edit/", r"/modify/", r"PUT.*/api/", r"PATCH.*/api/"],
        "DELETE": [r"/delete/", r"/remove/", r"DELETE.*/api/"],
        "SELECT": [r"/list$", r"/get$", r"/fetch$", r"/query$", r"GET.*/api/"],
    }

    # SQL keywords for operation detection
    SQL_KEYWORDS = {
        "INSERT": ["INSERT INTO"],
        "UPDATE": ["UPDATE"],
        "DELETE": ["DELETE FROM"],
        "SELECT": ["SELECT"],
    }

    # MongoDB operation indicators
    MONGODB_OPERATIONS = {
        "INSERT": ["insertOne", "insertMany", "insert"],
        "UPDATE": ["updateOne", "updateMany", "findOneAndUpdate", "update"],
        "DELETE": ["deleteOne", "deleteMany", "findOneAndDelete", "remove"],
        "SELECT": ["find", "findOne", "aggregate"],
    }

    def __init__(self):
        self.db_operations: Dict[str, List[Dict]] = {}  # run_id -> operations
        self.flow_data: Dict[str, List[Dict]] = {}  # run_id -> flow mappings
        self.current_page_url: Dict[str, str] = {}  # run_id -> current page URL

    async def start_monitoring(self, page, run_id: str):
        """
        Attach network listeners to capture database operations.

        Args:
            page: Playwright page object
            run_id: Current discovery/test run ID
        """
        if run_id not in self.db_operations:
            self.db_operations[run_id] = []
            self.flow_data[run_id] = []
            self.current_page_url[run_id] = ""

        async def handle_request(request):
            """Handle outgoing requests."""
            try:
                # Track current page URL
                if request.resource_type == "document":
                    self.current_page_url[run_id] = request.url

                # Check if this is a potential database operation
                operation = await self._parse_request(request, run_id)
                if operation:
                    logger.info(f"[{run_id}] Captured DB operation: {operation['operation_type']} on {operation.get('table_name', 'unknown')}")

            except Exception as e:
                logger.debug(f"Error handling request in DB flow tracer: {e}")

        async def handle_response(response):
            """Handle responses to extract additional operation details."""
            try:
                request = response.request

                # Only process API requests
                if not self._is_api_request(request.url, request.method):
                    return

                # Try to extract database operation details from response
                await self._parse_response(request, response, run_id)

            except Exception as e:
                logger.debug(f"Error handling response in DB flow tracer: {e}")

        # Attach listeners
        page.on("request", handle_request)
        page.on("response", handle_response)

        logger.info(f"[{run_id}] Database flow tracer monitoring started")

    def _is_api_request(self, url: str, method: str) -> bool:
        """
        Heuristic to detect if request is an API call that might involve database.

        Args:
            url: Request URL
            method: HTTP method

        Returns:
            True if likely an API request
        """
        url_lower = url.lower()

        # Check for common API indicators
        api_indicators = ["/api/", "/rest/", "/graphql", "/v1/", "/v2/"]
        if any(indicator in url_lower for indicator in api_indicators):
            return True

        # Check for REST-like patterns
        if method in ["POST", "PUT", "PATCH", "DELETE"]:
            return True

        return False

    def _detect_operation_type(self, url: str, method: str, body: Optional[str] = None) -> Optional[str]:
        """
        Detect database operation type from URL, method, and body.

        Args:
            url: Request URL
            method: HTTP method
            body: Request body (if available)

        Returns:
            Operation type (INSERT, UPDATE, DELETE, SELECT) or None
        """
        # Check URL patterns
        url_method = f"{method} {url}"
        for op_type, patterns in self.DB_OPERATION_PATTERNS.items():
            for pattern in patterns:
                if re.search(pattern, url_method, re.IGNORECASE):
                    return op_type

        # Check SQL in body
        if body:
            for op_type, keywords in self.SQL_KEYWORDS.items():
                for keyword in keywords:
                    if keyword in body.upper():
                        return op_type

            # Check MongoDB operations
            for op_type, operations in self.MONGODB_OPERATIONS.items():
                for operation in operations:
                    if operation in body:
                        return op_type

        # Default mapping based on HTTP method
        method_mapping = {
            "POST": "INSERT",
            "PUT": "UPDATE",
            "PATCH": "UPDATE",
            "DELETE": "DELETE",
            "GET": "SELECT",
        }

        return method_mapping.get(method)

    def _extract_table_name(self, url: str, body: Optional[str] = None) -> Optional[str]:
        """
        Extract table/collection name from URL or request body.

        Args:
            url: Request URL
            body: Request body (if available)

        Returns:
            Table or collection name, or None
        """
        # Parse URL path
        parsed_url = urlparse(url)
        path_segments = [s for s in parsed_url.path.split("/") if s]

        # Common patterns: /api/users, /api/v1/products, /rest/orders
        if len(path_segments) >= 2:
            # Usually the last segment before IDs (numeric or UUID)
            for i in range(len(path_segments) - 1, -1, -1):
                segment = path_segments[i]
                # Skip segments that look like IDs
                if not re.match(r'^[0-9a-f-]+$', segment) and segment not in ["api", "rest", "v1", "v2", "v3"]:
                    return segment

        # Try to extract from SQL query in body
        if body:
            # Look for table name after FROM, INTO, UPDATE, DELETE FROM
            sql_patterns = [
                r'FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)',
                r'INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)',
                r'UPDATE\s+([a-zA-Z_][a-zA-Z0-9_]*)',
            ]
            for pattern in sql_patterns:
                match = re.search(pattern, body, re.IGNORECASE)
                if match:
                    return match.group(1)

        return None

    async def _parse_request(self, request, run_id: str) -> Optional[Dict]:
        """
        Parse request to extract database operation.

        Args:
            request: Playwright request object
            run_id: Current run ID

        Returns:
            Database operation dict or None
        """
        url = request.url
        method = request.method

        # Only process API requests
        if not self._is_api_request(url, method):
            return None

        # Get request body
        try:
            body = request.post_data if hasattr(request, 'post_data') else None
        except Exception:
            body = None

        # Detect operation type
        operation_type = self._detect_operation_type(url, method, body)
        if not operation_type:
            return None

        # Extract table name
        table_name = self._extract_table_name(url, body)

        # Create operation record
        operation = {
            "operation_type": operation_type,
            "table_name": table_name,
            "api_endpoint": url,
            "api_method": method,
            "source_url": self.current_page_url.get(run_id, ""),
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "query_text": body[:500] if body else None,  # Truncate for storage
        }

        # Store operation
        self.db_operations[run_id].append(operation)

        # Track flow (UI → API → DB → Table)
        self._track_flow(run_id, operation)

        return operation

    async def _parse_response(self, request, response, run_id: str):
        """
        Parse response to extract additional operation details.

        Args:
            request: Playwright request object
            response: Playwright response object
            run_id: Current run ID
        """
        try:
            # Look for successful creation/update/delete
            status = response.status
            if status in [201, 204]:  # Created or No Content
                operation_type = "INSERT" if status == 201 else "UPDATE"

                table_name = self._extract_table_name(request.url)
                if table_name:
                    operation = {
                        "operation_type": operation_type,
                        "table_name": table_name,
                        "api_endpoint": request.url,
                        "api_method": request.method,
                        "source_url": self.current_page_url.get(run_id, ""),
                        "timestamp": datetime.utcnow().isoformat() + "Z",
                        "query_text": None,
                    }

                    self.db_operations[run_id].append(operation)
                    self._track_flow(run_id, operation)

        except Exception as e:
            logger.debug(f"Error parsing response: {e}")

    def _track_flow(self, run_id: str, operation: Dict):
        """
        Track flow mapping: UI → API → DB → Table.

        Args:
            run_id: Current run ID
            operation: Database operation dict
        """
        if not operation.get("table_name"):
            return

        # Create flow entry
        flow = {
            "source_page_url": operation.get("source_url", ""),
            "api_endpoint": operation.get("api_endpoint", ""),
            "api_method": operation.get("api_method", ""),
            "target_table": operation.get("table_name", ""),
            "operation_type": operation.get("operation_type", ""),
            "timestamp": operation.get("timestamp", ""),
        }

        # Check if similar flow already exists (merge)
        existing_flow = None
        for f in self.flow_data[run_id]:
            if (f.get("api_endpoint") == flow["api_endpoint"] and
                f.get("target_table") == flow["target_table"] and
                f.get("operation_type") == flow["operation_type"]):
                existing_flow = f
                break

        if existing_flow:
            # Increment count
            existing_flow["operation_count"] = existing_flow.get("operation_count", 1) + 1
            existing_flow["last_seen"] = flow["timestamp"]
        else:
            # New flow
            flow["operation_count"] = 1
            flow["first_seen"] = flow["timestamp"]
            flow["last_seen"] = flow["timestamp"]
            self.flow_data[run_id].append(flow)

    async def generate_flow_diagram(self, run_id: str) -> Dict:
        """
        Generate visual flow diagram data structure (UI → API → DB → Table).

        Args:
            run_id: Run ID to generate diagram for

        Returns:
            Flow diagram data in format similar to discovery_appmap.json
        """
        flows = self.flow_data.get(run_id, [])
        operations = self.db_operations.get(run_id, [])

        # Extract unique nodes
        pages = set()
        apis = set()
        tables = set()

        for flow in flows:
            if flow.get("source_page_url"):
                pages.add(flow["source_page_url"])
            if flow.get("api_endpoint"):
                apis.add(flow["api_endpoint"])
            if flow.get("target_table"):
                tables.add(flow["target_table"])

        # Build node structures
        page_nodes = [{"id": f"page_{i}", "type": "page", "url": url} for i, url in enumerate(pages)]
        api_nodes = [{"id": f"api_{i}", "type": "api", "endpoint": endpoint} for i, endpoint in enumerate(apis)]
        table_nodes = [{"id": f"table_{i}", "type": "table", "name": table} for i, table in enumerate(tables)]

        # Build edges (connections)
        edges = []
        for flow in flows:
            # Find node IDs
            page_id = None
            api_id = None
            table_id = None

            if flow.get("source_page_url"):
                page_id = f"page_{list(pages).index(flow['source_page_url'])}"

            if flow.get("api_endpoint"):
                api_id = f"api_{list(apis).index(flow['api_endpoint'])}"

            if flow.get("target_table"):
                table_id = f"table_{list(tables).index(flow['target_table'])}"

            # Create edges: Page → API → Table
            if page_id and api_id:
                edges.append({
                    "from": page_id,
                    "to": api_id,
                    "type": "triggers",
                    "method": flow.get("api_method", ""),
                })

            if api_id and table_id:
                edges.append({
                    "from": api_id,
                    "to": table_id,
                    "type": "operates_on",
                    "operation": flow.get("operation_type", ""),
                    "count": flow.get("operation_count", 1),
                })

        # Build diagram structure
        diagram = {
            "version": "1.0",
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "run_id": run_id,
            "summary": {
                "total_operations": len(operations),
                "total_flows": len(flows),
                "unique_pages": len(pages),
                "unique_apis": len(apis),
                "unique_tables": len(tables),
            },
            "flows": flows,
            "nodes": {
                "pages": page_nodes,
                "apis": api_nodes,
                "tables": table_nodes,
            },
            "edges": edges,
        }

        return diagram

    def get_operations(self, run_id: str) -> List[Dict]:
        """Get all captured operations for a run."""
        return self.db_operations.get(run_id, [])

    def get_flows(self, run_id: str) -> List[Dict]:
        """Get all flow mappings for a run."""
        return self.flow_data.get(run_id, [])

    def clear_run_data(self, run_id: str):
        """Clear all data for a specific run."""
        self.db_operations.pop(run_id, None)
        self.flow_data.pop(run_id, None)
        self.current_page_url.pop(run_id, None)
