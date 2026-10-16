"""Privacy-aware logging: metadata only, never raw page text or URLs with query strings."""
import json
import logging
import sys

_logger = logging.getLogger("verity")
if not _logger.handlers:
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(logging.Formatter("%(message)s"))
    _logger.addHandler(h)
    _logger.setLevel(logging.INFO)

_ALLOWED = {"request_id", "duration_ms", "status", "error_category", "provider", "schema_version",
            "evidence_count", "finding_count", "dropped_findings"}


def log_event(event: str, **fields) -> None:
    safe = {k: v for k, v in fields.items() if k in _ALLOWED}
    _logger.info(json.dumps({"event": event, **safe}))
