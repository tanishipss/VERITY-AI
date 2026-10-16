"""Deterministic cost math. Decimal only; never invents fees; keeps currencies separate."""
from collections import Counter
from decimal import ROUND_HALF_UP, Decimal

from app.schemas.models import CostSummary, Money, Period, PriceItem

_CENT = Decimal("0.01")


def _q(x: Decimal) -> Decimal:
    return x.quantize(_CENT, rounding=ROUND_HALF_UP)


def compute_costs(items: list[PriceItem], currency_hint: str | None = None) -> tuple[CostSummary, list[str]]:
    """Returns (summary, unknowns)."""
    summary = CostSummary(assumptions=[])
    unknowns: list[str] = []
    if not items:
        unknowns.append("No price could be confirmed from this page.")
        return summary, unknowns

    counts = Counter(i.currency for i in items)
    primary = currency_hint if currency_hint in counts else counts.most_common(1)[0][0]
    if len(counts) > 1:
        others = ", ".join(sorted(c for c in counts if c != primary))
        summary.assumptions.append(
            f"Prices in more than one currency were found; totals use {primary} only and are not converted ({others} excluded)."
        )
    use = [i for i in items if i.currency == primary]

    def first(period: Period) -> PriceItem | None:
        return next((i for i in use if i.period == period), None)

    intro, monthly = first(Period.first_month), first(Period.monthly)
    after_intro, yearly, one_time = first(Period.monthly_after_intro), first(Period.yearly), first(Period.one_time)
    recurring = after_intro or monthly

    if recurring:
        summary.recurring_monthly = Money(amount=recurring.amount, currency=primary)
        summary.annualized_estimate = Money(amount=_q(recurring.amount * 12), currency=primary)
        summary.assumptions.append("Annualized estimate = recurring monthly price × 12; an estimate, not an invoice quote.")

    if intro:
        summary.first_30_days = Money(amount=intro.amount, currency=primary)
        if recurring:
            summary.assumptions.append("Introductory price and later recurring price are shown separately, not averaged.")
    elif recurring:
        summary.first_30_days = Money(amount=recurring.amount, currency=primary)
    elif one_time:
        summary.first_30_days = Money(amount=one_time.amount, currency=primary)
    elif yearly:
        summary.first_30_days = Money(amount=yearly.amount, currency=primary)
    else:
        unknowns.append("A price was found but its billing period is not stated, so recurring cost is unknown.")

    if yearly:
        summary.annual_billed = Money(amount=yearly.amount, currency=primary)
        summary.annual_monthly_equivalent = Money(amount=_q(yearly.amount / 12), currency=primary)
        summary.assumptions.append("Annual plan: monthly equivalent = annual price ÷ 12, but billing still occurs once per year.")

    summary.assumptions.append("Taxes, shipping and checkout fees are excluded unless shown on the page.")
    return summary, unknowns
