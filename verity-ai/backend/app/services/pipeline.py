"""Orchestrates: normalize -> deterministic costs -> bounded LLM -> evidence validation."""
from app.schemas.models import AnalyzeRequest, AnalyzeResponse, Offer, Status
from app.services.cost_engine import compute_costs
from app.services.evidence_validator import validate_findings
from app.services.llm import LLMAdapter, LLMError
from app.services.normalization import extract_price_items
from app.services.risk_rules import apply_rules, find_unknowns, next_steps

LIMITATIONS = [
    "Analysis reflects the supplied page content only; it may not include every checkout fee or term.",
    "This is an aid for your decision, not legal or financial advice, and not a guarantee about the merchant.",
]


def analyze(req: AnalyzeRequest, adapter: LLMAdapter) -> tuple[AnalyzeResponse, int]:
    """Returns (response, dropped_finding_count)."""
    items = extract_price_items(req.evidence, req.currency_hint)
    costs, unknowns = compute_costs(items, req.currency_hint)

    status = Status.complete
    limitations = list(LIMITATIONS)
    try:
        raw = adapter.explain(req)
    except LLMError:
        # Provider outage / bad output: fall back to rules, and say so.
        raw = apply_rules(req.evidence)
        status = Status.partial
        limitations.append("The AI explanation step was unavailable; findings come from basic keyword checks only.")

    findings, dropped = validate_findings(raw, req.evidence)
    unknowns += find_unknowns(findings, req.page.page_type_hint)

    if not items and not findings:
        status = Status.unsupported
    offer = Offer(name=req.page.title or None, merchant=req.page.merchant_domain or None, price_items=items)
    return (
        AnalyzeResponse(status=status, offer=offer, cost_summary=costs, findings=findings,
                        unknowns=unknowns, limitations=limitations, next_steps=next_steps(findings, unknowns)),
        dropped,
    )
