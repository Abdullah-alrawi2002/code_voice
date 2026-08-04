"""Server-side Realtime controls for incoming SIP phone calls."""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

from pydantic import ValidationError
from websockets.asyncio.client import connect

from .agent_config import OPENING_RESPONSE
from .models import CaseCreate
from .store import CaseStore

logger = logging.getLogger(__name__)


def caller_phone_from_headers(headers: list[Any] | None) -> str:
    for header in headers or []:
        if isinstance(header, dict):
            name = str(header.get("name", ""))
            value = str(header.get("value", ""))
        else:
            name = str(getattr(header, "name", ""))
            value = str(getattr(header, "value", ""))
        if name.lower() != "from":
            continue
        match = re.search(r"(?:sip:|tel:)(\+?[0-9][0-9().\- ]+)", value)
        return match.group(1).strip() if match else value[:80]
    return ""


def _public_case_result(case: Any) -> dict[str, Any]:
    return {
        "ok": True,
        "case_id": case.id,
        "status": case.status,
        "priority": case.priority,
        "assigned_to": case.assigned_to or "Not yet assigned",
        "updated_at": case.updated_at.isoformat(),
    }


def execute_support_tool(
    store: CaseStore,
    *,
    name: str,
    arguments: dict[str, Any],
    source: str,
    call_id: str | None = None,
    existing_case_id: str | None = None,
) -> dict[str, Any]:
    """Execute a narrow Realtime tool with server-side validation."""

    if name == "create_support_case":
        if existing_case_id:
            existing = store.get_case(existing_case_id)
            if existing:
                return {
                    **_public_case_result(existing),
                    "already_created": True,
                    "message": "This call already has a support case.",
                }
        try:
            payload = CaseCreate.model_validate(
                {
                    **arguments,
                    "source": source,
                    "call_id": call_id,
                }
            )
        except ValidationError as exc:
            missing = [
                ".".join(str(part) for part in error["loc"])
                for error in exc.errors()
            ]
            return {
                "ok": False,
                "error": "The report is incomplete or invalid.",
                "fields_to_correct": missing[:12],
            }
        case = store.create_case(payload)
        return {
            **_public_case_result(case),
            "message": "Support case created successfully.",
        }

    if name == "lookup_case_by_id":
        case = store.get_case(str(arguments.get("case_id", "")))
        if case is None:
            return {"ok": False, "error": "No case found for that case ID."}
        return _public_case_result(case)

    if name == "lookup_case_by_phone":
        case = store.get_latest_by_phone(str(arguments.get("phone", "")))
        if case is None:
            return {"ok": False, "error": "No case found for that phone number."}
        return _public_case_result(case)

    return {"ok": False, "error": f"Unsupported tool: {name}"}


def _text_from_item(item: dict[str, Any]) -> tuple[str, str] | None:
    if item.get("type") != "message":
        return None
    role = "Caller" if item.get("role") == "user" else "Agent"
    parts: list[str] = []
    for content in item.get("content") or []:
        if not isinstance(content, dict):
            continue
        value = content.get("transcript") or content.get("text")
        if isinstance(value, str) and value.strip():
            parts.append(value.strip())
    if not parts:
        return None
    return role, " ".join(parts)


async def monitor_sip_call(store: CaseStore, call_id: str) -> None:
    """Monitor a connected SIP call, run tools, and persist its transcript."""

    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key:
        logger.error("Cannot monitor SIP call %s without OPENAI_API_KEY", call_id)
        store.finish_call(call_id, case_id=None, transcript="", status="failed")
        return

    transcript_lines: list[str] = []
    seen_transcript_keys: set[str] = set()
    tool_results: dict[str, dict[str, Any]] = {}
    created_case_id: str | None = None
    final_status = "completed"

    def add_transcript(role: str, text: str, key: str) -> None:
        clean = text.strip()
        if not clean or key in seen_transcript_keys:
            return
        seen_transcript_keys.add(key)
        transcript_lines.append(f"{role}: {clean}")

    try:
        async with connect(
            f"wss://api.openai.com/v1/realtime?call_id={call_id}",
            additional_headers={"Authorization": f"Bearer {api_key}"},
            open_timeout=15,
        ) as websocket:
            await websocket.send(json.dumps(OPENING_RESPONSE))

            async for raw_message in websocket:
                event = json.loads(raw_message)
                event_type = event.get("type")

                if event_type == "conversation.item.done":
                    item = event.get("item") or {}
                    extracted = _text_from_item(item)
                    if extracted:
                        add_transcript(
                            extracted[0],
                            extracted[1],
                            str(item.get("id") or event.get("event_id") or len(transcript_lines)),
                        )

                elif event_type == "conversation.item.input_audio_transcription.completed":
                    add_transcript(
                        "Caller",
                        str(event.get("transcript") or ""),
                        f"caller:{event.get('item_id', event.get('event_id', ''))}",
                    )

                elif event_type == "response.output_audio_transcript.done":
                    add_transcript(
                        "Agent",
                        str(event.get("transcript") or ""),
                        f"agent:{event.get('item_id', event.get('event_id', ''))}",
                    )

                elif event_type == "response.done":
                    for item in (event.get("response") or {}).get("output") or []:
                        if item.get("type") != "function_call":
                            continue
                        tool_call_id = str(item.get("call_id") or "")
                        if not tool_call_id:
                            continue
                        if tool_call_id in tool_results:
                            result = tool_results[tool_call_id]
                        else:
                            try:
                                arguments = json.loads(item.get("arguments") or "{}")
                            except json.JSONDecodeError:
                                arguments = {}
                            result = execute_support_tool(
                                store,
                                name=str(item.get("name") or ""),
                                arguments=arguments,
                                source="phone",
                                call_id=call_id,
                                existing_case_id=created_case_id,
                            )
                            tool_results[tool_call_id] = result
                            if result.get("ok") and result.get("case_id"):
                                created_case_id = str(result["case_id"])

                        await websocket.send(
                            json.dumps(
                                {
                                    "type": "conversation.item.create",
                                    "item": {
                                        "type": "function_call_output",
                                        "call_id": tool_call_id,
                                        "output": json.dumps(result),
                                    },
                                }
                            )
                        )
                        await websocket.send(json.dumps({"type": "response.create"}))

                elif event_type == "error":
                    logger.warning(
                        "Realtime error on SIP call %s: %s",
                        call_id,
                        (event.get("error") or {}).get("message", "Unknown error"),
                    )

    except Exception:
        final_status = "failed"
        logger.exception("SIP sideband connection failed for call %s", call_id)
    finally:
        store.finish_call(
            call_id,
            case_id=created_case_id,
            transcript="\n".join(transcript_lines),
            status=final_status,
        )
