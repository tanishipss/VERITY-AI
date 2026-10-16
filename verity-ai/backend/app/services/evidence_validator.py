"""Reject or downgrade model claims that are not backed by supplied evidence."""
import re

from app.schemas.models import Evidence, Finding, FindingKind, Severity

_VERDICT_WORDS = re.compile(
    r"\b(scam|scammer|fraud|fraudulent|phishing|fake|100% (?:safe|legit\w*)|totally safe|guaranteed safe)\b", re.I
)
_ORDER = {Severity.important: 0, Severity.caution: 1, Severity.info: 2}


def validate_findings(findings: list[Finding], evidence: list[Evidence]) -> tuple[list[Finding], int]:
    """Returns (kept findings with stable ids, number dropped)."""
    valid_ids = {e.id for e in evidence}
    kept: list[Finding] = []
    dropped = 0
    for f in findings:
        if _VERDICT_WORDS.search(f"{f.label} {f.explanation}"):
            dropped += 1  # no verdict language from weak signals
            continue
        ids = [i for i in f.evidence_ids if i in valid_ids]
        if f.kind != FindingKind.general_caution and not ids:
            dropped += 1  # unsupported claim
            continue
        update = {"evidence_ids": ids}
        if f.kind == FindingKind.potential_concern and f.severity == Severity.important:
            update["severity"] = Severity.caution
        kept.append(f.model_copy(update=update))
    kept.sort(key=lambda f: _ORDER[f.severity])
    kept = [f.model_copy(update={"id": f"finding_{n:03d}"}) for n, f in enumerate(kept, 1)]
    return kept, dropped
