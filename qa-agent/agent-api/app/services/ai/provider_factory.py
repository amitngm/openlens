"""Factory for creating LLM providers."""

import logging
from typing import Dict, Any, Optional

from app.services.ai.llm_provider import LLMProvider
from app.services.ai.ollama_provider import OllamaProvider
from app.services.ai.openai_provider import OpenAIProvider

logger = logging.getLogger(__name__)

# Global provider cache
_provider_cache: Dict[str, LLMProvider] = {}


def create_llm_provider(config: Dict[str, Any]) -> Optional[LLMProvider]:
    """
    Create an LLM provider based on configuration.
    
    Args:
        config: Provider configuration with 'provider' field
        
    Returns:
        LLMProvider instance or None if disabled/invalid
    """
    if not config.get("enabled", False):
        logger.debug("AI provider disabled in config")
        return None
    
    provider_type = config.get("provider", "none")
    
    if provider_type == "none":
        return None
    
    # Create cache key
    cache_key = f"{provider_type}_{config.get('model_name', 'default')}"
    
    # Return cached provider if available
    if cache_key in _provider_cache:
        return _provider_cache[cache_key]
    
    try:
        if provider_type == "ollama":
            provider = OllamaProvider(config)
        elif provider_type == "openai":
            provider = OpenAIProvider(config)
        else:
            logger.warning(f"Unknown provider type: {provider_type}")
            return None
        
        # Cache the provider
        _provider_cache[cache_key] = provider
        logger.info(f"Created {provider_type} provider with model {config.get('model_name')}")
        return provider
    
    except Exception as e:
        logger.error(f"Failed to create {provider_type} provider: {e}")
        return None


def get_llm_provider(config: Dict[str, Any]) -> Optional[LLMProvider]:
    """
    Get or create an LLM provider.
    
    This is a convenience function that calls create_llm_provider.
    
    Args:
        config: Provider configuration
        
    Returns:
        LLMProvider instance or None
    """
    return create_llm_provider(config)


def clear_provider_cache():
    """Clear the provider cache (useful for testing)."""
    global _provider_cache
    _provider_cache.clear()
