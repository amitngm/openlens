"""Ollama LLM provider for local model inference."""

import json
import logging
from typing import Dict, Any, Optional
import aiohttp
from urllib.parse import urljoin

from app.services.ai.llm_provider import LLMProvider

logger = logging.getLogger(__name__)


class OllamaProvider(LLMProvider):
    """Ollama provider for local LLM models."""
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.base_url = config.get("base_url", "http://localhost:11434")
        self.model_name = config.get("model_name", "llama2")
        self.timeout = config.get("timeout", 60)
        self._session: Optional[aiohttp.ClientSession] = None
    
    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create aiohttp session."""
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=self.timeout)
            )
        return self._session
    
    async def generate_text(
        self, 
        prompt: str, 
        system_prompt: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 2000
    ) -> str:
        """Generate text using Ollama API."""
        try:
            session = await self._get_session()
            url = urljoin(self.base_url, "/api/generate")
            
            payload = {
                "model": self.model_name,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": temperature,
                    "num_predict": max_tokens
                }
            }
            
            if system_prompt:
                payload["system"] = system_prompt
            
            async with session.post(url, json=payload) as response:
                if response.status != 200:
                    error_text = await response.text()
                    logger.error(f"Ollama API error {response.status}: {error_text}")
                    raise Exception(f"Ollama API error: {error_text}")
                
                result = await response.json()
                return result.get("response", "")
        
        except aiohttp.ClientError as e:
            logger.error(f"Ollama connection error: {e}")
            raise Exception(f"Failed to connect to Ollama: {e}")
        except Exception as e:
            logger.error(f"Ollama generation error: {e}")
            raise
    
    async def generate_structured(
        self,
        prompt: str,
        schema: Dict[str, Any],
        system_prompt: Optional[str] = None,
        temperature: float = 0.7
    ) -> Dict[str, Any]:
        """Generate structured JSON output."""
        # Enhance prompt with schema instructions
        schema_prompt = f"""
Generate a JSON response matching this schema:
{json.dumps(schema, indent=2)}

{prompt}

Respond with ONLY valid JSON matching the schema above.
"""
        
        response_text = await self.generate_text(
            prompt=schema_prompt,
            system_prompt=system_prompt,
            temperature=temperature,
            max_tokens=4000
        )
        
        # Try to extract JSON from response
        try:
            # Remove markdown code blocks if present
            if "```json" in response_text:
                response_text = response_text.split("```json")[1].split("```")[0].strip()
            elif "```" in response_text:
                response_text = response_text.split("```")[1].split("```")[0].strip()
            
            return json.loads(response_text)
        except json.JSONDecodeError as e:
            logger.warning(f"Failed to parse JSON from Ollama response: {e}")
            logger.debug(f"Response text: {response_text[:500]}")
            # Return empty structure matching schema
            return self._create_empty_schema(schema)
    
    async def is_available(self) -> bool:
        """Check if Ollama is available."""
        try:
            session = await self._get_session()
            url = urljoin(self.base_url, "/api/tags")
            
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as response:
                return response.status == 200
        except Exception as e:
            logger.debug(f"Ollama availability check failed: {e}")
            return False
    
    def _create_empty_schema(self, schema: Dict[str, Any]) -> Dict[str, Any]:
        """Create empty structure matching schema."""
        # Simple schema matching - can be enhanced
        if schema.get("type") == "object":
            return {}
        elif schema.get("type") == "array":
            return []
        return {}
    
    async def __aenter__(self):
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._session and not self._session.closed:
            await self._session.close()
