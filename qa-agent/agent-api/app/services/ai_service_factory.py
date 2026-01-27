"""Factory for creating AI-enhanced services."""

import logging
from typing import Optional, Dict, Any

from app.services.enhanced_test_case_generator import EnhancedTestCaseGenerator
from app.services.ai.provider_factory import get_llm_provider
from app.services.ai.test_case_ai_generator import TestCaseAIGenerator
from app.models.ai_config import AIConfig

logger = logging.getLogger(__name__)


def create_enhanced_test_case_generator(ai_config: Optional[AIConfig] = None) -> EnhancedTestCaseGenerator:
    """
    Create EnhancedTestCaseGenerator with optional AI support.
    
    Args:
        ai_config: Optional AI configuration. If None, creates generator without AI.
        
    Returns:
        EnhancedTestCaseGenerator instance
    """
    ai_generator = None
    
    if ai_config and ai_config.enabled and ai_config.provider != "none":
        try:
            # Convert AIConfig to dict for provider
            provider_config = {
                "enabled": ai_config.enabled,
                "provider": ai_config.provider,
                "model_name": ai_config.model_name,
                "api_key": ai_config.api_key,
                "base_url": ai_config.base_url,
                "temperature": ai_config.temperature,
                "max_tokens": ai_config.max_tokens,
                "timeout": ai_config.timeout
            }
            
            # Create LLM provider
            llm_provider = get_llm_provider(provider_config)
            
            if llm_provider:
                # Check if provider is available
                import asyncio
                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        # Can't check availability in running loop, assume available
                        available = True
                    else:
                        available = loop.run_until_complete(llm_provider.is_available())
                except RuntimeError:
                    # No event loop, create new one
                    available = asyncio.run(llm_provider.is_available())
                
                if available:
                    ai_generator = TestCaseAIGenerator(llm_provider)
                    logger.info(f"AI test case generator created with {ai_config.provider} provider")
                else:
                    logger.warning(f"AI provider {ai_config.provider} is not available, using rule-based only")
            else:
                logger.warning("Failed to create LLM provider, using rule-based only")
        
        except Exception as e:
            logger.warning(f"Failed to initialize AI generator: {e}, using rule-based only")
    
    # Create generator with or without AI
    return EnhancedTestCaseGenerator(ai_generator=ai_generator)
