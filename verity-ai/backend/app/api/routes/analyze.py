import time
import uuid
from collections import defaultdict, deque

from fastapi import APIRouter, HTTPException, Request

from app.core.config import settings
from app.core.logging import log_event
from app.schemas.models import AnalyzeRequest, AnalyzeResponse
from app.services.llm import get_adapter
from app.services.pipeline import analyze

router = APIRouter()
_hits: dict[str, deque] = defaultdict(deque)


def _rate_limit(key: str) -> None:
    now = time.monotonic()
    q = _hits[key]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= settings.rate_limit_per_minute:
        raise HTTPException(status_code=429, detail="Too many checks. Please wait a minute and try again.")
    q.append(now)


@router.post("/analyze", response_model=AnalyzeResponse)
def analyze_route(req: AnalyzeRequest, request: Request) -> AnalyzeResponse:
    rid = uuid.uuid4().hex[:12]
    _rate_limit(request.client.host if request.client else "unknown")
    if sum(len(e.text) for e in req.evidence) > settings.max_evidence_items * settings.max_evidence_chars:
        raise HTTPException(status_code=413, detail="Page content is too large to analyze.")
    start = time.monotonic()
    adapter = get_adapter()
    resp, dropped = analyze(req, adapter)
    log_event("analyze", request_id=rid, duration_ms=int((time.monotonic() - start) * 1000),
              status=resp.status.value, provider=adapter.name, schema_version=resp.schema_version,
              evidence_count=len(req.evidence), finding_count=len(resp.findings), dropped_findings=dropped)
    return resp
