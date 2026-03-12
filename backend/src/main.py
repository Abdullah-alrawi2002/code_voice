"""FastAPI backend for case management."""

import os
from pathlib import Path

from dotenv import dotenv_values, load_dotenv

_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env_path, override=True)
import uuid
from datetime import datetime
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Case Management API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

cases: dict[str, dict] = {}

ISSUE_TYPES = frozenset({"missed_service", "update_request", "other"})
STATUSES = frozenset({"new", "in_progress", "resolved"})


class CreateCaseRequest(BaseModel):
    name: str
    phone: str
    issue_type: Literal["missed_service", "update_request", "other"]
    description: str


class UpdateCaseRequest(BaseModel):
    status: str | None = None
    notes: str | None = None


class Case(BaseModel):
    id: str
    name: str
    phone: str
    issue_type: str
    description: str
    status: str
    notes: str
    created_at: str
    updated_at: str


@app.post("/cases", response_model=Case)
def create_case(req: CreateCaseRequest):
    if req.issue_type not in ISSUE_TYPES:
        raise HTTPException(400, f"issue_type must be one of {list(ISSUE_TYPES)}")
    now = datetime.utcnow().isoformat() + "Z"
    case = {
        "id": uuid.uuid4().hex[:8],
        "name": req.name,
        "phone": req.phone,
        "issue_type": req.issue_type,
        "description": req.description,
        "status": "new",
        "notes": "",
        "created_at": now,
        "updated_at": now,
    }
    cases[case["id"]] = case
    return case


@app.get("/cases", response_model=list[Case])
def list_cases():
    return sorted(cases.values(), key=lambda c: c["created_at"], reverse=True)


@app.get("/cases/{case_id}", response_model=Case)
def get_case(case_id: str):
    if case_id not in cases:
        raise HTTPException(404, "Case not found")
    return cases[case_id]


@app.get("/cases/by-phone/{phone}", response_model=Case | None)
def get_case_by_phone(phone: str):
    for c in cases.values():
        if c["phone"] == phone:
            return c
    return None


@app.patch("/cases/{case_id}", response_model=Case)
def update_case(case_id: str, req: UpdateCaseRequest):
    if case_id not in cases:
        raise HTTPException(404, "Case not found")
    case = cases[case_id]
    if req.status is not None:
        if req.status not in STATUSES:
            raise HTTPException(400, f"status must be one of {list(STATUSES)}")
        case["status"] = req.status
    if req.notes is not None:
        case["notes"] = req.notes
    case["updated_at"] = datetime.utcnow().isoformat() + "Z"
    return case


@app.post("/voice/token")
def get_voice_token():
    """Return an OpenAI Realtime ephemeral client secret for the voice agent."""
    import httpx
    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key:
        file_key = (dotenv_values(_env_path).get("OPENAI_API_KEY") or "").strip()
        api_key = file_key
    if not api_key:
        raise HTTPException(500, "OPENAI_API_KEY must be set")
    try:
        r = httpx.post(
            "https://api.openai.com/v1/realtime/client_secrets",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "session": {
                    "type": "realtime",
                    "model": "gpt-realtime",
                },
            },
            timeout=10.0,
        )
        r.raise_for_status()
        data = r.json()
        return {"token": data.get("value", ""), "url": None}
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, e.response.text)


class SummarizeRequest(BaseModel):
    transcript: str
    case_id: str | None = None


def _extract_case_id(transcript: str) -> str | None:
    import re
    m = re.search(r"ID:\s*([a-f0-9]{8})", transcript, re.IGNORECASE)
    if m:
        return m.group(1)
    m = re.search(r"case\s+(?:id|created)[:\s]+([a-f0-9]{8})", transcript, re.IGNORECASE)
    if m:
        return m.group(1)
    m = re.search(r"\b([a-f0-9]{8})\b", transcript)
    if m:
        return m.group(1)
    return None


@app.post("/voice/summarize")
def summarize_call(req: SummarizeRequest):
    """Generate a call summary and attach it to the case if one was created."""
    import httpx
    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key:
        file_key = (dotenv_values(_env_path).get("OPENAI_API_KEY") or "").strip()
        api_key = file_key
    if not api_key:
        raise HTTPException(500, "OPENAI_API_KEY must be set")
    transcript = (req.transcript or "").strip()
    if not transcript:
        return {"summary": "No transcript.", "case_id": None, "attached": False}
    try:
        r = httpx.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": "gpt-4o-mini",
                "messages": [
                    {"role": "system", "content": "Summarize this customer service call in 2-3 sentences. Include: caller intent, any case created or looked up, and outcome."},
                    {"role": "user", "content": transcript},
                ],
                "max_tokens": 200,
            },
            timeout=15.0,
        )
        r.raise_for_status()
        data = r.json()
        summary = (data.get("choices") or [{}])[0].get("message", {}).get("content", "").strip() or "Summary unavailable."
        case_id = req.case_id or _extract_case_id(transcript)
        attached = False
        if case_id and case_id in cases:
            prefix = "[Call summary] " if not cases[case_id]["notes"] else "\n\n[Call summary] "
            cases[case_id]["notes"] = (cases[case_id]["notes"] or "").rstrip() + prefix + summary
            cases[case_id]["updated_at"] = datetime.utcnow().isoformat() + "Z"
            attached = True
        return {"summary": summary, "case_id": case_id, "attached": attached}
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, e.response.text)
