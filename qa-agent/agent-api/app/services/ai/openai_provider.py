"""OpenAI LLM provider for cloud-based model inference."""

import json
import logging
from typing import Dict, Any, Optional

from app.services.ai.llm_provider import LLMProvider

logger = logging.getLogger(__name__)

# Try to import openai, but make it optional
try:
    import openai
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False
    logger.warning("OpenAI library not installed. Install with: pip install openai")


class OpenAIProvider(LLMProvider):
    """OpenAI provider for GPT models."""
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        if not OPENAI_AVAILABLE:
            raise ImportError("OpenAI library not installed. Install with: pip install openai")
        
        self.api_key = config.get("api_key")
        if not self.api_key:
            raise ValueError("OpenAI API key is required")
        
        self.model_name = config.get("model_name", "gpt-3.5-turbo")
        self.timeout = config.get("timeout", 60)
        
        # Initialize OpenAI client
        self.client = openai.AsyncOpenAI(
            api_key=self.api_key,
            timeout=self.timeout
        )
    
    async def generate_text(
        self, 
        prompt: str, 
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 2000
    ) -> str:
        """Generate text using OpenAI API."""
        try:
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": prompt})
            
            response = await self.client.chat.completions.create(
                model=self.model_name,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens
            )
            
            return response.choices[0].message.content
            
        except Exception as e:
            logger.error(f"OpenAI generation error: {e}")
            raise Exception(f"OpenAI API error: {e}")
    
    async def generate_structured(
        self,
        prompt: str,
        schema: Dict[str, Any],
        system_prompt: Optional[str] = None,
        temperature: float = 0.7
    ) -> Dict[str, Any]:
        """Generate structured JSON output using function calling."""
        try:
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": prompt})
            
            # Use function calling for structured output
            functions = [{
                "name": "generate_response",
                "description": "Generate structured response",
                "parameters": schema
            }]
            
            response = await self.client.chat.completions.create(
                model=self.model_name,
                messages=messages,
                functions=functions,
                function_call={"name": "generate_response"},
                temperature=temperature
            )
            
            # Extract function call arguments
            message = response.choices[0].message
            if message.function_call:
                return json.loads(message.function_call.arguments)
            else:
                # Fallback to parsing content
                content = message.content
                try:
                    return json.loads(content)
                except json.JSONDecodeError:
                    return self._create_empty_schema(schema)
        
        except Exception as e:
            logger.error(f"OpenAI structured generation error: {e}")
            # Return empty structure on error
            return self._create_empty_schema(schema)
    
    async def is_available(self) -> bool:
        """Check if OpenAI is available."""
        try:
            # Simple check - try to list models
            await self.client.models.list()
            return True
        except Exception as e:
            logger.debug(f"OpenAI availability check failed: {e}")
            return False
    
    def _create_empty_schema(self, schema: Dict[str, Any]) -> Dict[str, Any]:
        """Create empty structure matching schema."""
        if schema.get("type") == "object":
            return {}
        elif schema.get("type") == "array":
            return []
        return {}
