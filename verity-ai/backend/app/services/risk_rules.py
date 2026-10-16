"""Rule-based findings. Each rule fires only on text that is present, and cites it."""
import re
from dataclasses import dataclass

from app.schemas.models import Category, Confidence, Evidence, Finding, FindingKind, Severity


@dataclass(frozen=True)
class Rule:
    category: Category
    pattern: re.Pattern
    label: str
    explanation: str
    severity: Severity
    kind: FindingKind = FindingKind.supported_fact
    confidence: Confidence = Confidence.high


def _r(p: str) -> re.Pattern:
    return re.compile(p, re.I)


RULES: list[Rule] = [
    Rule(Category.trial, _r(r"free trial|trial (?:period|ends)|try (?:it )?free|\d+[- ]day trial"),
         "A trial period is mentioned",
         "The page mentions a trial. Check what happens when it ends, including whether billing starts automatically.",
         Severity.important),
    Rule(Category.renewal, _r(r"auto[- ]?renew|renews? (?:automatically|at|for)|recurring (?:billing|charge)|billed (?:monthly|annually|yearly)|\bthen\b\s*\S{0,4}\d"),
         "Recurring or renewal charge stated",
         "The page describes a charge that continues or changes after the first period.",
         Severity.important),
    Rule(Category.cancellation, _r(r"cancel(?:l?ation)?\b"),
         "Cancellation language found",
         "The page mentions cancellation. Read the exact wording to see when and how you can cancel.",
         Severity.caution),
    Rule(Category.commitment, _r(r"minimum (?:term|commitment|contract)|\d+[- ]month (?:contract|commitment|minimum)|annual (?:contract|commitment)|locked in"),
         "A minimum commitment is mentioned",
         "The page indicates a minimum term or contract length.",
         Severity.important),
    Rule(Category.refund, _r(r"refund|money[- ]back|non[- ]refundable|returns? (?:policy|within)"),
         "Refund or return terms mentioned",
         "The page mentions refunds or returns. Check the conditions and time limits.",
         Severity.caution),
    Rule(Category.fees, _r(r"(?:setup|activation|service|processing|handling|booking|admin(?:istration)?) fee|plus (?:applicable )?(?:tax|fees)|taxes? (?:extra|not included|may apply)"),
         "Additional fees are mentioned",
         "The page mentions fees or taxes beyond the headline price.",
         Severity.important),
    Rule(Category.shipping, _r(r"shipping|delivery (?:fee|charge|cost)|postage"),
         "Shipping terms mentioned",
         "The page mentions shipping or delivery. Confirm the cost for your location at checkout.",
         Severity.info),
    Rule(Category.concern, _r(r"only \d+ left|hurry|offer ends (?:in|today|soon)|limited[- ]time|act now|countdown"),
         "Urgency wording present",
         "The page uses urgency wording. This is common and not proof of a problem; check the price on your own terms.",
         Severity.info, FindingKind.potential_concern, Confidence.low),
]

_UNKNOWN_TEXT = {
    Category.cancellation: "Cancellation terms were not found in the checked content.",
    Category.refund: "Refund terms were not found in the checked content.",
    Category.fees: "Taxes or checkout fees were not shown in the checked content.",
    Category.shipping: "Shipping costs were not found in the checked content.",
    Category.renewal: "Renewal terms were not found in the checked content.",
}

_NEXT_STEP = {
    Category.renewal: "Confirm the renewal amount and billing date before subscribing.",
    Category.trial: "Check how and when a trial converts to a paid plan.",
    Category.cancellation: "Read the full cancellation steps before committing.",
    Category.commitment: "Confirm the minimum term and any early-exit cost.",
    Category.refund: "Read the refund conditions and time limits.",
    Category.fees: "Check the final total at checkout, including fees and taxes.",
    Category.shipping: "Confirm shipping cost for your location at checkout.",
}


def apply_rules(evidence: list[Evidence]) -> list[Finding]:
    findings: list[Finding] = []
    for rule in RULES:
        ids = [e.id for e in evidence if rule.pattern.search(e.text)]
        if ids:
            findings.append(Finding(category=rule.category, severity=rule.severity, label=rule.label,
                                    explanation=rule.explanation, evidence_ids=ids[:3],
                                    confidence=rule.confidence, kind=rule.kind))
    return findings


def find_unknowns(findings: list[Finding], page_type: str) -> list[str]:
    found = {f.category for f in findings}
    wanted = [Category.cancellation, Category.refund, Category.fees]
    wanted.append(Category.renewal if page_type == "subscription" else Category.shipping)
    return [_UNKNOWN_TEXT[c] for c in wanted if c not in found]


def next_steps(findings: list[Finding], unknowns: list[str]) -> list[str]:
    steps = [_NEXT_STEP[f.category] for f in findings if f.category in _NEXT_STEP]
    if unknowns:
        steps.append("Terms may exist elsewhere (checkout, FAQ, legal pages); look there for anything marked not found.")
    seen: list[str] = []
    for s in steps:
        if s not in seen:
            seen.append(s)
    return seen[:4]
