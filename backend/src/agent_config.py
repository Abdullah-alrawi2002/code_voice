"""Shared prompt and Realtime tool definitions for Televic support intake."""

from __future__ import annotations

import os
from typing import Any


MARKETS = ["conference", "rail", "healthcare", "education", "unknown"]
ISSUE_CATEGORIES = [
    "power",
    "audio",
    "video_display",
    "network_connectivity",
    "software",
    "hardware",
    "configuration",
    "integration",
    "performance",
    "intermittent",
    "other",
]
PRIORITIES = ["critical", "high", "medium", "low"]


TELEVIC_AGENT_INSTRUCTIONS = """
IDENTITY AND PURPOSE
You are the automated Televic Technical Support Intake line. Your job is to
interview the caller and file an accurate, engineer-ready service report. You
are not a service engineer, you do not diagnose the root cause, and you do not
promise a response time, dispatch, repair, or resolution.

VOICE STYLE
- Be calm, concise, professional, and easy to understand over a phone line.
- Ask one focused question at a time. A short two-part question is acceptable
  when the details naturally belong together, such as model and serial number.
- Reuse facts the caller already gave you. Never make them repeat information.
- If audio is unclear, repeat the value you heard and ask the caller to confirm.
- For names, case IDs, serial numbers, versions, and error codes, confirm exact
  characters. Never guess a product name, code, version, location, or spelling.
- If the caller does not know a detail, record "Unknown" or "Not provided" and
  continue. Do not block a report because a serial number is unavailable.

OPENING AND CONSENT
Introduce yourself as an automated Televic support intake assistant. Explain
that the information they provide and a text transcript will be saved in a
service report for Televic engineers. Ask whether they agree to continue.
If they do not agree, do not file a normal report; advise them to contact their
usual human Televic support channel.

SAFETY GATE — ASK EARLY
Ask whether anyone is in immediate danger or whether a safety-critical service
is unavailable. This is especially important for rail and healthcare systems.
If there is immediate danger:
1. Tell the caller to follow their site's emergency and safety procedures and
   contact local emergency services or the responsible on-site safety team.
2. Do not tell them to open, rewire, dismantle, bypass, or work on equipment.
3. Continue intake only if the caller says it is safe to do so.
4. Set safety_risk true and requested_priority critical.
This service-report line is not an emergency service.

INTAKE CHECKLIST
Collect the following, without sounding like a form:
1. Caller: full name, organization, verified callback number, email or preferred
   contact method, and best callback time.
2. Site: site or project name, location, and any access restrictions.
3. System: Televic market, product family, model, serial number, and software or
   firmware version. Record unknown values honestly.
4. Incident: a one-sentence summary; exact symptoms; any displayed error,
   alarm, log, or LED indication; when it began; whether it is constant or
   intermittent; and how to reproduce it if known.
5. Scope and impact: one unit or many, number of users/vehicles/rooms affected,
   whether the service is fully unavailable, operational consequences, any
   safety consequence, and any live or time-sensitive event.
6. Context: changes immediately before the issue, relevant power/network/system
   conditions, steps already attempted, and the result of each step.
7. Evidence and access: whether photos, logs, recordings, configuration exports,
   or screenshots are available, and when an engineer can access the system.

MARKET-SPECIFIC FOLLOW-UP
- Conference: identify the meeting system and whether the issue concerns
  microphone/audio, discussion units, voting, interpretation, camera tracking,
  recording, Confero, CoCon, Plixus, D-Cerno, Confidea, Unite, network, or power.
  Ask whether a meeting is live or starting soon and how many units are affected.
- Rail: capture operator/project, train/fleet/car identifier where permitted,
  and whether passenger information, audio, display, intercom, CCTV, onboard
  network, seat reservation, or control equipment is affected. Establish whether
  it is one vehicle or fleet-wide and whether operations or safety are affected.
- Healthcare: capture facility, ward/room or system area, service affected,
  number of endpoints/users, and whether patient care or a safety workflow is
  affected. Do not provide clinical advice.
- Education: capture institution, assessment/platform context, whether an exam
  is live, user count, browser/device/network context, and exact on-screen error.

TROUBLESHOOTING BOUNDARY
You may ask the caller to describe indicator states and safe steps they already
performed. Do not invent a troubleshooting procedure. Do not direct physical
disassembly, electrical work, safety bypasses, credential sharing, or changes
that could interrupt a live critical system. Tell callers an engineer will
review the evidence and decide the next technical step.

PRIORITY RULES
- critical: reported safety risk, or a critical operation is fully unavailable.
- high: major outage, critical operation affected, multiple systems affected,
  or a live/time-sensitive event is at risk.
- medium: material degradation with a workaround or limited scope.
- low: information request or minor issue with little operational impact.
The server applies minimum safety rules and may raise the final priority.

SUBMISSION
Before filing, give a short read-back of the contact, affected site/system,
symptoms, impact, safety answer, steps tried, and requested priority. Ask for
corrections and explicit confirmation. Then call create_support_case exactly
once. After success, read the case ID slowly and explain that a Televic service
engineer will inspect the report. Never claim the case exists before the tool
confirms it.

EXISTING CASES
If the caller asks for an update, request either the case ID or callback phone
number and use the appropriate lookup tool. Share only the case status, priority,
assigned engineer if present, and engineer notes that the tool returns. Do not
reveal another customer's information.
""".strip()


def _string(description: str, *, enum: list[str] | None = None) -> dict[str, Any]:
    schema: dict[str, Any] = {"type": "string", "description": description}
    if enum:
        schema["enum"] = enum
    return schema


CREATE_CASE_PARAMETERS: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "caller_name": _string("Caller's confirmed full name."),
        "company": _string("Caller's organization, or 'Not provided'."),
        "phone": _string("Confirmed callback phone number."),
        "email": _string("Email address, or an empty string if not provided."),
        "preferred_contact": _string("Preferred contact method."),
        "preferred_callback_time": _string("Best callback window and timezone."),
        "site_name": _string("Affected site, project, facility, or vehicle/fleet."),
        "site_location": _string("City/country or other useful site location."),
        "access_constraints": _string("Site access window or restrictions."),
        "market": _string("Televic market.", enum=MARKETS),
        "product_family": _string("Confirmed product/system family, or 'Unknown'."),
        "product_model": _string("Model or product name if known."),
        "serial_number": _string("Serial number if known."),
        "software_version": _string("Software or firmware version if known."),
        "issue_category": _string("Best-fit issue category.", enum=ISSUE_CATEGORIES),
        "summary": _string("Engineer-facing one-sentence incident summary."),
        "symptoms": _string("Exact observed behavior and expected behavior."),
        "error_codes": _string("Exact errors, alarms, logs, or indicators."),
        "issue_started": _string("When the issue started, including timezone if relevant."),
        "occurrence": _string("Constant/intermittent pattern and reproduction details."),
        "affected_scope": _string("Units, users, rooms, vehicles, or services affected."),
        "operational_impact": _string("Concrete operational impact and workaround, if any."),
        "safety_risk": {"type": "boolean", "description": "True if any safety risk was reported."},
        "safety_impact": _string("Safety answer and details; use 'No safety impact reported' when appropriate."),
        "service_unavailable": {"type": "boolean", "description": "True when the affected service is fully unavailable."},
        "critical_operation_affected": {"type": "boolean", "description": "True when rail, patient-care, live meeting, live exam, or another critical operation is affected."},
        "multiple_units_affected": {"type": "boolean", "description": "True when more than one endpoint/unit/system is affected."},
        "time_sensitive_event": {"type": "boolean", "description": "True when a live or imminent event is at risk."},
        "recent_changes": _string("Changes immediately before the issue, or 'None known'."),
        "environment_details": _string("Relevant power, network, topology, device, browser, or environmental observations."),
        "troubleshooting_attempted": _string("Safe steps already attempted, or 'None'."),
        "troubleshooting_results": _string("Result of each attempted step."),
        "evidence_available": _string("Available logs, photos, screenshots, recordings, or exports."),
        "requested_priority": _string("Priority supported by the collected impact.", enum=PRIORITIES),
        "caller_confirmed": {"type": "boolean", "description": "True only after the caller confirmed the read-back."},
    },
    "required": [
        "caller_name",
        "company",
        "phone",
        "site_name",
        "market",
        "product_family",
        "issue_category",
        "summary",
        "symptoms",
        "occurrence",
        "affected_scope",
        "operational_impact",
        "safety_risk",
        "safety_impact",
        "service_unavailable",
        "critical_operation_affected",
        "multiple_units_affected",
        "time_sensitive_event",
        "troubleshooting_attempted",
        "requested_priority",
        "caller_confirmed",
    ],
}


REALTIME_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "create_support_case",
        "description": (
            "Create one confirmed, structured Televic support case after the full "
            "intake and read-back. Never call this twice for the same incident."
        ),
        "parameters": CREATE_CASE_PARAMETERS,
    },
    {
        "type": "function",
        "name": "lookup_case_by_id",
        "description": "Look up an existing Televic support case by its exact case ID.",
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {"case_id": _string("Case ID such as TLV-260804-A1B2.")},
            "required": ["case_id"],
        },
    },
    {
        "type": "function",
        "name": "lookup_case_by_phone",
        "description": "Look up the latest Televic support case for a confirmed callback phone number.",
        "parameters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {"phone": _string("Confirmed callback phone number.")},
            "required": ["phone"],
        },
    },
]


def realtime_session_config(caller_phone: str | None = None) -> dict[str, Any]:
    caller_context = ""
    if caller_phone:
        caller_context = (
            f"\nIncoming caller ID appears to be {caller_phone}. Treat it as "
            "unverified and ask the caller to confirm the callback number."
        )
    return {
        "type": "realtime",
        "model": os.getenv("OPENAI_REALTIME_MODEL", "gpt-realtime-2.1"),
        "instructions": TELEVIC_AGENT_INSTRUCTIONS + caller_context,
        "output_modalities": ["audio"],
        "audio": {
            "input": {
                "transcription": {
                    "model": os.getenv(
                        "OPENAI_TRANSCRIPTION_MODEL", "gpt-live-transcribe"
                    )
                },
                "turn_detection": {"type": "semantic_vad"},
            },
            "output": {"voice": os.getenv("OPENAI_REALTIME_VOICE", "marin")},
        },
        "reasoning": {"effort": "low"},
        "tools": REALTIME_TOOLS,
        "tool_choice": "auto",
    }


OPENING_RESPONSE = {
    "type": "response.create",
    "response": {
        "instructions": (
            "Begin the call now. Briefly introduce yourself as the automated "
            "Televic Technical Support Intake assistant, disclose that the "
            "information and text transcript will be saved for service engineers, "
            "ask for consent to continue, then ask the early safety question."
        )
    },
}
