from decimal import Decimal
from enum import Enum
from typing import Annotated, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator

SCHEMA_VERSION = "1.0"
ALLOWED_SCHEMES = {"http", "https"}


class Period(str, Enum):
    one_time = "one_time"
    first_month = "first_month"
    monthly = "monthly"
    monthly_after_intro = "monthly_after_intro"
    yearly = "yearly"
    unspecified = "unspecified"


class Category(str, Enum):
    renewal = "renewal"
    trial = "trial"
    cancellation = "cancellation"
    commitment = "commitment"
    refund = "refund"
    fees = "fees"
    shipping = "shipping"
    concern = "concern"


class Severity(str, Enum):
    important = "important"
    caution = "caution"
    info = "info"


class Confidence(str, Enum):
    high = "high"
    medium = "medium"
    low = "low"


class FindingKind(str, Enum):
    supported_fact = "supported_fact"
    inference = "inference"
    potential_concern = "potential_concern"
    general_caution = "general_caution"


class Status(str, Enum):
    complete = "complete"
    partial = "partial"
    unsupported = "unsupported"


class Evidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: Annotated[str, Field(pattern=r"^[A-Za-z0-9_\-]{1,40}$")]
    kind: Literal["visible_text", "price_candidate", "terms_snippet"] = "visible_text"
    text: Annotated[str, Field(min_length=1, max_length=1200)]


class Page(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: Annotated[str, Field(max_length=2048)]
    title: Annotated[str, Field(max_length=300)] = ""
    merchant_domain: Annotated[str, Field(max_length=255)] = ""
    page_type_hint: Literal["product", "subscription", "unknown"] = "unknown"

    @field_validator("url")
    @classmethod
    def _scheme(cls, v: str) -> str:
        if urlparse(v).scheme.lower() not in ALLOWED_SCHEMES:
            raise ValueError("unsupported URL scheme")
        return v


class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: str
    page: Page
    evidence: Annotated[list[Evidence], Field(min_length=1, max_length=40)]
    locale: Annotated[str, Field(max_length=16)] = "en"
    currency_hint: Annotated[str | None, Field(pattern=r"^[A-Z]{3}$")] = None

    @field_validator("schema_version")
    @classmethod
    def _version(cls, v: str) -> str:
        if v.split(".")[0] != SCHEMA_VERSION.split(".")[0]:
            raise ValueError("unsupported schema_version")
        return v


class Money(BaseModel):
    amount: Decimal
    currency: str

    @field_serializer("amount")
    def _ser(self, v: Decimal) -> str:
        return f"{v:.2f}"


class PriceItem(BaseModel):
    amount: Decimal
    currency: str
    period: Period
    evidence_id: str | None = None

    @field_serializer("amount")
    def _ser(self, v: Decimal) -> str:
        return f"{v:.2f}"


class Offer(BaseModel):
    name: str | None = None
    merchant: str | None = None
    price_items: list[PriceItem] = []


class CostSummary(BaseModel):
    first_30_days: Money | None = None
    recurring_monthly: Money | None = None
    annualized_estimate: Money | None = None
    annual_billed: Money | None = None
    annual_monthly_equivalent: Money | None = None
    assumptions: list[str] = []


class Finding(BaseModel):
    id: str = ""
    category: Category
    severity: Severity
    label: str
    explanation: str
    evidence_ids: list[str] = []
    confidence: Confidence
    kind: FindingKind


class AnalyzeResponse(BaseModel):
    schema_version: str = SCHEMA_VERSION
    status: Status
    offer: Offer
    cost_summary: CostSummary
    findings: list[Finding] = []
    unknowns: list[str] = []
    limitations: list[str] = []
    next_steps: list[str] = []
