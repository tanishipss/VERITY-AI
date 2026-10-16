"""Turn raw evidence text into normalized price items. Pure, deterministic, no model involved."""
import re
from decimal import Decimal, InvalidOperation

from app.schemas.models import Evidence, Period, PriceItem

_CODES = "USD|EUR|GBP|INR|JPY|CAD|AUD|CHF|SEK|NOK|DKK|NZD|SGD|MXN|BRL|ZAR"
_SYMBOLS = {"€": "EUR", "£": "GBP", "₹": "INR", "¥": "JPY", "A$": "AUD", "C$": "CAD", "US$": "USD"}
_DOLLAR_CODES = {"USD", "CAD", "AUD", "NZD", "SGD", "MXN"}

_NUM = r"\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?"
_PRICE_RE = re.compile(
    rf"(?P<sym>US\$|A\$|C\$|[$€£₹¥])\s?(?P<n1>{_NUM})"
    rf"|(?P<n2>{_NUM})\s?(?P<code1>{_CODES})\b"
    rf"|\b(?P<code2>{_CODES})\s?(?P<n3>{_NUM})"
)

_MONTHLY = re.compile(r"/\s?(?:mo|month)\b|per month|a month|monthly|each month|every month", re.I)
_YEARLY = re.compile(r"/\s?(?:yr|year)\b|per year|a year|yearly|annual(?:ly)?|every year", re.I)
_INTRO = re.compile(r"first (?:month|\d+ days?|30 days)|introductory|intro\b|for your first|trial", re.I)
_AFTER = re.compile(r"\bthen\b|\bafter\b|renews? (?:at|for)|thereafter|regular price", re.I)
_ONE_TIME = re.compile(r"one[- ]time|single payment|pay once", re.I)


def _to_decimal(raw: str) -> Decimal | None:
    try:
        return Decimal(raw.replace(",", ""))
    except InvalidOperation:
        return None


def _currency(sym: str | None, code: str | None, hint: str | None) -> str | None:
    if code:
        return code
    if sym == "$":
        return hint if hint in _DOLLAR_CODES else "USD"
    return _SYMBOLS.get(sym or "")


def _period(before: str, after: str) -> Period:
    window = f"{before} {after}"
    intro, later = bool(_INTRO.search(window)), bool(_AFTER.search(before))
    if _MONTHLY.search(after) or (_MONTHLY.search(before) and not _YEARLY.search(after)):
        return Period.monthly_after_intro if later else Period.monthly
    if _YEARLY.search(after) or _YEARLY.search(before):
        return Period.yearly
    if later:
        return Period.unspecified  # "then $X" with no stated cadence
    if intro:
        return Period.first_month
    if _ONE_TIME.search(window):
        return Period.one_time
    return Period.unspecified


def extract_price_items(evidence: list[Evidence], currency_hint: str | None = None) -> list[PriceItem]:
    items: list[PriceItem] = []
    for ev in evidence:
        for m in _PRICE_RE.finditer(ev.text):
            raw = m.group("n1") or m.group("n2") or m.group("n3")
            amount = _to_decimal(raw)
            if amount is None or amount <= 0:
                continue
            cur = _currency(m.group("sym"), m.group("code1") or m.group("code2"), currency_hint)
            if not cur:
                continue
            before = ev.text[max(0, m.start() - 40): m.start()]
            after = ev.text[m.end(): m.end() + 45]
            # Don't let the next price's context bleed into this one.
            nxt = _PRICE_RE.search(after)
            if nxt:
                after = after[: nxt.start()]
            prev = list(_PRICE_RE.finditer(before))
            if prev:
                before = before[prev[-1].end():]
            items.append(PriceItem(amount=amount, currency=cur, period=_period(before, after), evidence_id=ev.id))
    seen: set[tuple] = set()
    unique: list[PriceItem] = []
    for it in items:
        key = (it.amount, it.currency, it.period)
        if key not in seen:
            seen.add(key)
            unique.append(it)
    return unique
