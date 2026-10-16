from typing import Protocol

from app.schemas.models import AnalyzeRequest, Finding


class LLMError(Exception):
    """Provider failure, timeout or unusable output."""


class LLMAdapter(Protocol):
    name: str

    def explain(self, req: AnalyzeRequest) -> list[Finding]:
        """Return findings interpreted ONLY from req.evidence. Never compute totals."""
        ...
