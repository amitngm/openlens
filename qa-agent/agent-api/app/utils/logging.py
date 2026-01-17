"""
Logging configuration with secret redaction.

Ensures no sensitive data is logged.
"""

import re
import logging
import json
from typing import Any, Dict
from datetime import datetime

from app.utils.config import SECRET_PATTERNS


class RedactingFilter(logging.Filter):
    """Filter that redacts sensitive information from log records."""
    
    REDACTION_PATTERNS = [
        re.compile(pattern, re.IGNORECASE) for pattern in SECRET_PATTERNS
    ]
    
    # Common secret value patterns
    VALUE_PATTERNS = [
        re.compile(r'Bearer\s+[A-Za-z0-9\-_\.]+', re.IGNORECASE),
        re.compile(r'Basic\s+[A-Za-z0-9\+/=]+', re.IGNORECASE),
        re.compile(r'ghp_[A-Za-z0-9]+'),  # GitHub tokens
        re.compile(r'gho_[A-Za-z0-9]+'),  # GitHub OAuth
        re.compile(r'sk-[A-Za-z0-9]+'),   # API keys
        re.compile(r'eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+'),  # JWTs
    ]
    
    REDACTED = "[REDACTED]"
    
    def filter(self, record: logging.LogRecord) -> bool:
        """Redact sensitive data from log record."""
        if hasattr(record, 'msg'):
            record.msg = self._redact_string(str(record.msg))
        
        if hasattr(record, 'args') and record.args:
            record.args = tuple(
                self._redact_string(str(arg)) if isinstance(arg, str) else arg
                for arg in record.args
            )
        
        return True
    
    def _redact_string(self, text: str) -> str:
        """Redact sensitive patterns from a string."""
        result = text
        
        # Redact known value patterns
        for pattern in self.VALUE_PATTERNS:
            result = pattern.sub(self.REDACTED, result)
        
        # Redact key-value pairs with sensitive keys
        for pattern in self.REDACTION_PATTERNS:
            # Match key=value or key: value patterns
            result = re.sub(
                rf'({pattern.pattern})\s*[=:]\s*["\']?([^"\'\s,}}]+)["\']?',
                rf'\1={self.REDACTED}',
                result,
                flags=re.IGNORECASE
            )
        
        return result


class JSONFormatter(logging.Formatter):
    """JSON log formatter for structured logging."""
    
    def __init__(self):
        super().__init__()
        self.redacting_filter = RedactingFilter()
    
    def format(self, record: logging.LogRecord) -> str:
        """Format log record as JSON."""
        # Apply redaction
        self.redacting_filter.filter(record)
        
        log_data = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
        }
        
        # Add exception info if present
        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)
        
        # Add extra fields
        for key, value in record.__dict__.items():
            if key not in [
                'name', 'msg', 'args', 'created', 'filename', 'funcName',
                'levelname', 'levelno', 'lineno', 'module', 'msecs',
                'pathname', 'process', 'processName', 'relativeCreated',
                'stack_info', 'exc_info', 'exc_text', 'thread', 'threadName',
                'taskName', 'message'
            ]:
                log_data[key] = value
        
        return json.dumps(log_data)


def setup_logging():
    """Configure application logging."""
    from app.utils.config import settings
    
    # Get root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, settings.LOG_LEVEL.upper()))
    
    # Remove existing handlers
    root_logger.handlers.clear()
    
    # Create handler
    handler = logging.StreamHandler()
    
    # Set formatter based on config
    if settings.LOG_FORMAT.lower() == "json":
        handler.setFormatter(JSONFormatter())
    else:
        handler.setFormatter(logging.Formatter(
            "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
        ))
    
    # Add redaction filter
    handler.addFilter(RedactingFilter())
    
    root_logger.addHandler(handler)
    
    # Reduce noise from third-party libraries
    logging.getLogger("kubernetes").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


def redact_dict(data: Dict[str, Any], keys_to_redact: list = None) -> Dict[str, Any]:
    """Redact sensitive keys from a dictionary."""
    if keys_to_redact is None:
        keys_to_redact = SECRET_PATTERNS
    
    redacted = {}
    for key, value in data.items():
        should_redact = any(
            re.search(pattern, key, re.IGNORECASE) 
            for pattern in keys_to_redact
        )
        
        if should_redact:
            redacted[key] = "[REDACTED]"
        elif isinstance(value, dict):
            redacted[key] = redact_dict(value, keys_to_redact)
        elif isinstance(value, list):
            redacted[key] = [
                redact_dict(item, keys_to_redact) if isinstance(item, dict) else item
                for item in value
            ]
        else:
            redacted[key] = value
    
    return redacted
