"""Typed support-case models and deterministic triage rules."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class StringEnum(str, Enum):
    """Enum base that serializes as a plain JSON string."""


class Market(StringEnum):
    conference = "conference"
    rail = "rail"
    healthcare = "healthcare"
    education = "education"
    unknown = "unknown"


class IssueCategory(StringEnum):
    power = "power"
    audio = "audio"
    video_display = "video_display"
    network_connectivity = "network_connectivity"
    software = "software"
    hardware = "hardware"
    configuration = "configuration"
    integration = "integration"
    performance = "performance"
    intermittent = "intermittent"
    other = "other"


class Priority(StringEnum):
    critical = "critical"
    high = "high"
    medium = "medium"
    low = "low"


class CaseStatus(StringEnum):
    new = "new"
    triaged = "triaged"
    in_progress = "in_progress"
    waiting_customer = "waiting_customer"
    resolved = "resolved"
    closed = "closed"


class CaseSource(StringEnum):
    browser_voice = "browser_voice"
    phone = "phone"
    api = "api"


class ModelBase(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        use_enum_values=True,
    )


class CaseCreate(ModelBase):
    """Structured information collected by the support intake agent."""

    source: CaseSource = CaseSource.api
    call_id: str | None = Field(default=None, max_length=160)

    caller_name: str = Field(min_length=1, max_length=120)
    company: str = Field(default="Not provided", min_length=1, max_length=160)
    phone: str = Field(min_length=3, max_length=60)
    email: str | None = Field(default=None, max_length=254)
    preferred_contact: str | None = Field(default=None, max_length=120)
    preferred_callback_time: str | None = Field(default=None, max_length=200)

    site_name: str = Field(min_length=1, max_length=200)
    site_location: str | None = Field(default=None, max_length=240)
    access_constraints: str | None = Field(default=None, max_length=1000)

    market: Market
    product_family: str = Field(min_length=1, max_length=200)
    product_model: str | None = Field(default=None, max_length=200)
    serial_number: str | None = Field(default=None, max_length=160)
    software_version: str | None = Field(default=None, max_length=160)

    issue_category: IssueCategory
    summary: str = Field(min_length=5, max_length=300)
    symptoms: str = Field(min_length=5, max_length=4000)
    error_codes: str | None = Field(default=None, max_length=1200)
    issue_started: str | None = Field(default=None, max_length=300)
    occurrence: str = Field(min_length=2, max_length=1000)
    affected_scope: str = Field(min_length=2, max_length=1500)

    operational_impact: str = Field(min_length=2, max_length=2500)
    safety_risk: bool = False
    safety_impact: str = Field(min_length=2, max_length=1500)
    service_unavailable: bool = False
    critical_operation_affected: bool = False
    multiple_units_affected: bool = False
    time_sensitive_event: bool = False

    recent_changes: str | None = Field(default=None, max_length=2000)
    environment_details: str | None = Field(default=None, max_length=2000)
    troubleshooting_attempted: str = Field(min_length=2, max_length=4000)
    troubleshooting_results: str | None = Field(default=None, max_length=2500)
    evidence_available: str | None = Field(default=None, max_length=1500)

    requested_priority: Priority = Priority.medium
    caller_confirmed: bool = False

    @field_validator(
        "email",
        "preferred_contact",
        "preferred_callback_time",
        "site_location",
        "access_constraints",
        "call_id",
        "product_model",
        "serial_number",
        "software_version",
        "error_codes",
        "issue_started",
        "recent_changes",
        "environment_details",
        "troubleshooting_results",
        "evidence_available",
        mode="before",
    )
    @classmethod
    def blank_to_none(cls, value: Any) -> Any:
        if isinstance(value, str) and not value.strip():
            return None
        return value


class CaseRecord(CaseCreate):
    id: str
    priority: Priority
    status: CaseStatus = CaseStatus.new
    assigned_to: str = ""
    engineer_notes: str = ""
    transcript: str = ""
    intake_completeness: int = Field(ge=0, le=100)
    attention_flags: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class CaseUpdate(ModelBase):
    status: CaseStatus | None = None
    priority: Priority | None = None
    assigned_to: str | None = Field(default=None, max_length=120)
    engineer_notes: str | None = Field(default=None, max_length=12000)


class FinalizeCallRequest(ModelBase):
    case_id: str | None = Field(default=None, max_length=40)
    transcript: str = Field(default="", max_length=100_000)
    source: CaseSource = CaseSource.browser_voice


class CaseListResponse(ModelBase):
    items: list[CaseRecord]
    total: int


_PRIORITY_RANK = {
    Priority.low.value: 0,
    Priority.medium.value: 1,
    Priority.high.value: 2,
    Priority.critical.value: 3,
}


def _priority_value(value: Priority | str) -> str:
    return value.value if isinstance(value, Priority) else value


def derive_priority(case: CaseCreate) -> Priority:
    """Apply non-LLM minimum priority rules so safety cannot be downgraded."""

    requested = _priority_value(case.requested_priority)
    minimum = Priority.low.value

    if case.safety_risk or (
        case.critical_operation_affected and case.service_unavailable
    ):
        minimum = Priority.critical.value
    elif (
        case.critical_operation_affected
        or case.service_unavailable
        or case.time_sensitive_event
    ):
        minimum = Priority.high.value
    elif case.multiple_units_affected:
        minimum = Priority.medium.value

    selected = max((requested, minimum), key=lambda p: _PRIORITY_RANK[p])
    return Priority(selected)


def intake_completeness(case: CaseCreate) -> int:
    """Score whether an engineer has the most useful first-look information."""

    checks = [
        bool(case.caller_name),
        bool(case.phone),
        bool(case.company and case.company.lower() != "not provided"),
        bool(case.site_name),
        case.market != Market.unknown.value,
        bool(case.product_family and case.product_family.lower() != "unknown"),
        bool(case.product_model or case.serial_number),
        bool(case.summary),
        bool(case.symptoms),
        bool(case.issue_started),
        bool(case.occurrence),
        bool(case.affected_scope),
        bool(case.operational_impact),
        bool(case.safety_impact),
        bool(case.troubleshooting_attempted),
        bool(case.troubleshooting_results),
        bool(case.recent_changes),
        bool(case.evidence_available),
        case.caller_confirmed,
    ]
    return round(sum(checks) / len(checks) * 100)


def build_attention_flags(case: CaseCreate, completeness: int) -> list[str]:
    flags: list[str] = []
    if case.safety_risk:
        flags.append("Safety risk reported")
    if case.critical_operation_affected:
        flags.append("Critical operation affected")
    if case.service_unavailable:
        flags.append("Service unavailable")
    if case.multiple_units_affected:
        flags.append("Multiple units or users affected")
    if case.time_sensitive_event:
        flags.append("Time-sensitive event")
    if completeness < 65:
        flags.append("Intake needs follow-up")
    return flags


def new_case_record(case_id: str, payload: CaseCreate) -> CaseRecord:
    now = utc_now()
    completeness = intake_completeness(payload)
    return CaseRecord(
        **payload.model_dump(),
        id=case_id,
        priority=derive_priority(payload),
        status=CaseStatus.new,
        assigned_to="",
        engineer_notes="",
        transcript="",
        intake_completeness=completeness,
        attention_flags=build_attention_flags(payload, completeness),
        created_at=now,
        updated_at=now,
    )
