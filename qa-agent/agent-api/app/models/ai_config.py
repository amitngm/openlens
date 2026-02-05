"""AI configuration models."""

from typing import Optional, Literal
from pydantic import BaseModel, Field


class AIConfig(BaseModel):
    """AI/LLM configuration for test generation."""
    
    enabled: bool = Field(default=True, description="Enable AI-powered features (Super Buddy mode)")
    mode: Literal["normal", "ai", "hybrid"] = Field(
        default="hybrid",
        description="Generation mode: normal (rule-based), ai (AI-only), hybrid (both - default for Super Buddy)"
    )
    provider: Literal["ollama", "openai", "none"] = Field(
        default="ollama",
        description="AI provider to use (ollama=free local AI, openai=cloud API, none=rule-based only)"
    )
    model_name: str = Field(
        default="llama2",
        description="Model name (e.g., 'llama2' for Ollama, 'gpt-3.5-turbo' for OpenAI)"
    )
    api_key: Optional[str] = Field(
        default=None,
        description="API key (required for OpenAI)"
    )
    base_url: Optional[str] = Field(
        default="http://localhost:11434",
        description="Base URL for Ollama (default: http://localhost:11434)"
    )
    temperature: float = Field(
        default=0.7,
        ge=0.0,
        le=2.0,
        description="Sampling temperature (0.0-2.0)"
    )
    max_tokens: int = Field(
        default=2000,
        ge=1,
        le=8000,
        description="Maximum tokens to generate"
    )
    timeout: int = Field(
        default=60,
        ge=1,
        description="Request timeout in seconds"
    )
    
    class Config:
        json_schema_extra = {
            "example": {
                "enabled": True,
                "mode": "hybrid",
                "provider": "ollama",
                "model_name": "llama2",
                "base_url": "http://localhost:11434",
                "temperature": 0.7,
                "max_tokens": 2000
            }
        }
