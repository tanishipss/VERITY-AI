from app.schemas.models import AnalyzeRequest, Finding
from app.services.risk_rules import apply_rules


class MockAdapter:
    """Deterministic, offline adapter: keyword rules only. Used for local dev and tests."""

    name = "mock"

    def explain(self, req: AnalyzeRequest) -> list[Finding]:
        return apply_rules(req.evidence)
