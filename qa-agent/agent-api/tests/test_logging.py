"""Tests for logging utilities."""

import pytest
from app.utils.logging import RedactingFilter, redact_dict


class TestRedactingFilter:
    """Tests for RedactingFilter."""
    
    def test_redacts_bearer_token(self):
        """Should redact Bearer tokens."""
        filter = RedactingFilter()
        text = "Authorization: Bearer abc123xyz789"
        result = filter._redact_string(text)
        
        assert "abc123xyz789" not in result
        assert "[REDACTED]" in result
    
    def test_redacts_password_in_key_value(self):
        """Should redact password values."""
        filter = RedactingFilter()
        text = "password=mysecretpassword"
        result = filter._redact_string(text)
        
        assert "mysecretpassword" not in result
        assert "[REDACTED]" in result
    
    def test_redacts_api_key(self):
        """Should redact API keys."""
        filter = RedactingFilter()
        text = "api_key: sk-12345abcdef"
        result = filter._redact_string(text)
        
        assert "sk-12345" not in result
    
    def test_preserves_non_sensitive_data(self):
        """Should preserve non-sensitive data."""
        filter = RedactingFilter()
        text = "username=testuser, environment=staging"
        result = filter._redact_string(text)
        
        assert "testuser" in result
        assert "staging" in result


class TestRedactDict:
    """Tests for redact_dict function."""
    
    def test_redacts_password_key(self):
        """Should redact password key."""
        data = {"username": "test", "password": "secret123"}
        result = redact_dict(data)
        
        assert result["username"] == "test"
        assert result["password"] == "[REDACTED]"
    
    def test_redacts_token_key(self):
        """Should redact token key."""
        data = {"api_token": "abc123"}
        result = redact_dict(data)
        
        assert result["api_token"] == "[REDACTED]"
    
    def test_redacts_nested_dict(self):
        """Should redact nested dictionaries."""
        data = {
            "user": {
                "name": "test",
                "credentials": {
                    "password": "secret"
                }
            }
        }
        result = redact_dict(data)
        
        assert result["user"]["name"] == "test"
        assert result["user"]["credentials"]["password"] == "[REDACTED]"
    
    def test_preserves_non_sensitive_keys(self):
        """Should preserve non-sensitive keys."""
        data = {"environment": "staging", "region": "us-east-1"}
        result = redact_dict(data)
        
        assert result["environment"] == "staging"
        assert result["region"] == "us-east-1"
