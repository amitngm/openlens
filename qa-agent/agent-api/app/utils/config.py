"""
Configuration settings for QA Agent API.

All settings can be overridden via environment variables.
"""

from typing import List, Optional
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Application settings with environment variable support."""
    
    # Environment Configuration
    ENVIRONMENT: str = Field(default="development", description="Current environment")
    NAMESPACE: str = Field(default="qa-agent", description="Kubernetes namespace to operate in")
    
    # API Configuration
    API_HOST: str = Field(default="0.0.0.0", description="API host")
    API_PORT: int = Field(default=8080, description="API port")
    ENABLE_DOCS: bool = Field(default=True, description="Enable OpenAPI docs")
    ALLOWED_ORIGINS: List[str] = Field(
        default=["http://localhost:3000", "http://localhost:8080", "http://127.0.0.1:3000", "http://127.0.0.1:8080"],
        description="CORS allowed origins"
    )
    
    # Target Service URLs (placeholders)
    UI_BASE_URL: str = Field(
        default="https://cmp.internal.example.com",
        description="CMP UI base URL"
    )
    API_BASE_URL: str = Field(
        default="https://api.internal.example.com",
        description="CMP API base URL"
    )
    
    # Discovery Configuration
    AUTO_DISCOVER_ON_STARTUP: bool = Field(default=True, description="Auto-discover on startup")
    DISCOVERY_INTERVAL_SECONDS: int = Field(default=300, description="Discovery refresh interval")
    DISCOVERY_RULES: str = Field(
        default="services,ingress,endpoints,configmaps",
        description="Comma-separated discovery rules"
    )
    
    # Security Guards
    ENV_GUARD_ENABLED: bool = Field(default=True, description="Enable environment guard")
    ENV_GUARD_PROD_ALLOWLIST: List[str] = Field(
        default=[],
        description="Flows allowed to run in production"
    )
    TEST_ACCOUNT_GUARD_ENABLED: bool = Field(
        default=True,
        description="Require testTenant=true variable"
    )
    
    # Rate Limiting
    MAX_CONCURRENT_RUNS: int = Field(default=5, description="Max concurrent test runs")
    MAX_RUNS_PER_FLOW: int = Field(default=1, description="Max concurrent runs per flow")
    
    # Artifact Storage
    ARTIFACTS_PATH: str = Field(default="/data/artifacts", description="Artifacts storage path")
    ARTIFACTS_RETENTION_DAYS: int = Field(default=7, description="Artifact retention in days")
    
    # Runner Configuration
    RUNNER_IMAGE: str = Field(
        default="qa-agent-runner:latest",
        description="Runner container image"
    )
    RUNNER_TIMEOUT_SECONDS: int = Field(default=600, description="Runner job timeout")
    RUNNER_MEMORY_LIMIT: str = Field(default="2Gi", description="Runner memory limit")
    RUNNER_CPU_LIMIT: str = Field(default="1000m", description="Runner CPU limit")
    
    # Kubernetes Configuration
    KUBECONFIG: Optional[str] = Field(default=None, description="Kubeconfig path (optional)")
    IN_CLUSTER: bool = Field(default=True, description="Running in Kubernetes cluster")
    
    # Logging
    LOG_LEVEL: str = Field(default="INFO", description="Log level")
    LOG_FORMAT: str = Field(default="json", description="Log format: json or text")
    
    # Secrets (loaded from Kubernetes secrets)
    UI_USERNAME: Optional[str] = Field(default=None, description="UI test account username")
    UI_PASSWORD: Optional[str] = Field(default=None, description="UI test account password")
    API_TOKEN: Optional[str] = Field(default=None, description="API bearer token")
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True


settings = Settings()


# Validation
def validate_settings():
    """Validate critical settings on startup."""
    errors = []
    
    if settings.ENV_GUARD_ENABLED and settings.ENVIRONMENT == "production":
        if not settings.ENV_GUARD_PROD_ALLOWLIST:
            errors.append(
                "ENV_GUARD: Running in production but no flows in allowlist. "
                "Set ENV_GUARD_PROD_ALLOWLIST or disable ENV_GUARD_ENABLED."
            )
    
    if errors:
        raise ValueError("Configuration errors: " + "; ".join(errors))


# Secret patterns for redaction
SECRET_PATTERNS = [
    r"password",
    r"secret",
    r"token",
    r"api[_-]?key",
    r"auth",
    r"credential",
    r"bearer",
    r"jwt",
]
