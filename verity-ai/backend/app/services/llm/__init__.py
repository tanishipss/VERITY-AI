from app.core.config import settings
from app.services.llm.base import LLMAdapter, LLMError
from app.services.llm.mock import MockAdapter

__all__ = ["LLMAdapter", "LLMError", "get_adapter"]


def get_adapter() -> LLMAdapter:
    if settings.llm_provider == "anthropic":
        from app.services.llm.anthropic_adapter import AnthropicAdapter

        return AnthropicAdapter()
    return MockAdapter()
