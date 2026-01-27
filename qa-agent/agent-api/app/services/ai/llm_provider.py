"""Abstract base class for LLM providers."""

from abc import ABC, abstractmethod
from typing import Dict, List, Any, Optional
import logging

logger = logging.getLogger(__name__)


class LLMProvider(ABC):
    """Abstract base class for LLM providers."""
    
    def __init__(self, config: Dict[str, Any]):
        """
        Initialize LLM provider.
        
        Args:
            config: Provider-specific configuration
        """
        self.config = config
        self.enabled = config.get("enabled", False)
    
    @abstractmethod
    async def generate_text(
        self, 
        prompt: str, 
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 2000
    ) -> str:
        """
        Generate text from prompt.
        
        Args:
            prompt: User prompt
            system_prompt: Optional system prompt
            temperature: Sampling temperature (0.0-2.0)
            max_tokens: Maximum tokens to generate
            
        Returns:
            Generated text
        """
        pass
    
    @abstractmethod
    async def generate_structured(
        self,
        prompt: str,
        schema: Dict[str, Any],
        system_prompt: Optional[str] = None,
        temperature: float = 0.7
    ) -> Dict[str, Any]:
        """
        Generate structured JSON output.
        
        Args:
            prompt: User prompt
            schema: JSON schema for expected output
            system_prompt: Optional system prompt
            temperature: Sampling temperature
            
        Returns:
            Structured data matching schema
        """
        pass
    
    @abstractmethod
    async def is_available(self) -> bool:
        """
        Check if provider is available and ready.
        
        Returns:
            True if provider is available
        """
        pass
    
    def _validate_config(self) -> bool:
        """Validate provider configuration."""
        return self.enabled
