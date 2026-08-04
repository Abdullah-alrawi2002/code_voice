"""FastAPI service for the Televic technical-support intake line."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Any

import httpx
from dotenv import dotenv_values, load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from openai import InvalidWebhookSignatureError, OpenAI

from .agent_config import realtime_session_config
from .models import (
    CaseCreate,
    CaseListResponse,
    CaseRecord,
    CaseUpdate,
    FinalizeCallRequest,
)
from .sip import caller_phone_from_headers, monitor_sip_call
from .store import CaseStore

BACKEND_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BACKEND_DIR / ".env"
load_dotenv(ENV_PATH, override=False)


def _setting(name: str, default: str = "") -> str:
    value = (os.getenv(name) or "").strip()
    if value:
        return value
    return str(dotenv_values(ENV_PATH).get(name) or default).strip()


def _database_path() -> Path:
    configured = _setting("DATABASE_PATH")
    if configured:
        path = Path(configured)
        return path if path.is_absolute() else BACKEND_DIR / path
    return BACKEND_DIR / "data" / "televic_support.db"


def _event_value(event: Any, name: str, default: Any = None) -> Any:
    if isinstance(event, dict):
        return event.get(name, default)
    return getattr(event, name, default)


def create_app(database_path: str | Path | None = None) -> FastAPI:
    app = FastAPI(
        title="Televic Technical Support API",
        version="1.0.0",
        description="Structured voice intake and service-engineer case management.",
    )
    store = CaseStore(database_path or _database_path())
    app.state.case_store = store
    app.state.call_tasks = set()

    origins = [
        value.strip()
        for value in _setting("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
        if value.strip()
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "televic-support"}

    @app.post("/cases", response_model=CaseRecord, status_code=201)
    def create_case(payload: CaseCreate) -> CaseRecord:
        return store.create_case(payload)

    @app.get("/cases", response_model=CaseListResponse)
    def list_cases(
        status: str | None = None,
        priority: str | None = None,
        market: str | None = None,
        q: str | None = None,
        limit: int = Query(default=200, ge=1, le=500),
        offset: int = Query(default=0, ge=0),
    ) -> CaseListResponse:
        return store.list_cases(
            status=status,
            priority=priority,
            market=market,
            query=q,
            limit=limit,
            offset=offset,
        )

    @app.get("/cases/stats")
    def case_stats() -> dict[str, object]:
        return store.summary_counts()

    @app.get("/cases/by-phone/{phone}", response_model=CaseRecord | None)
    def get_case_by_phone(phone: str) -> CaseRecord | None:
        return store.get_latest_by_phone(phone)

    @app.get("/cases/{case_id}", response_model=CaseRecord)
    def get_case(case_id: str) -> CaseRecord:
        case = store.get_case(case_id)
        if case is None:
            raise HTTPException(404, "Case not found")
        return case

    @app.get("/cases/{case_id}/export")
    def export_case(case_id: str) -> JSONResponse:
        payload = store.export_case(case_id)
        if payload is None:
            raise HTTPException(404, "Case not found")
        return JSONResponse(
            payload,
            headers={
                "Content-Disposition": (
                    f'attachment; filename="{case_id.upper()}-service-report.json"'
                )
            },
        )

    @app.patch("/cases/{case_id}", response_model=CaseRecord)
    def update_case(case_id: str, update: CaseUpdate) -> CaseRecord:
        case = store.update_case(case_id, update)
        if case is None:
            raise HTTPException(404, "Case not found")
        return case

    @app.post("/voice/token")
    async def get_voice_token() -> dict[str, str | None]:
        """Create a short-lived browser credential for a Realtime voice session."""

        api_key = _setting("OPENAI_API_KEY")
        if not api_key:
            raise HTTPException(500, "OPENAI_API_KEY must be set")
        model = _setting("OPENAI_REALTIME_MODEL", "gpt-realtime-2.1")
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                "https://api.openai.com/v1/realtime/client_secrets",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={"session": {"type": "realtime", "model": model}},
            )
        if response.is_error:
            raise HTTPException(response.status_code, response.text)
        data = response.json()
        return {"token": data.get("value", ""), "model": model, "url": None}

    @app.post("/voice/finalize")
    def finalize_browser_call(payload: FinalizeCallRequest) -> dict[str, object]:
        if not payload.case_id:
            return {
                "attached": False,
                "case_id": None,
                "message": "The call ended before a support case was filed.",
            }
        case = store.attach_transcript(payload.case_id, payload.transcript)
        if case is None:
            raise HTTPException(404, "Case not found")
        return {
            "attached": True,
            "case_id": case.id,
            "priority": case.priority,
            "message": "Transcript attached to the service report.",
        }

    @app.post("/webhooks/openai")
    async def openai_realtime_webhook(request: Request) -> Response:
        """Accept signed Realtime SIP calls and start the sideband controller."""

        webhook_secret = _setting("OPENAI_WEBHOOK_SECRET")
        api_key = _setting("OPENAI_API_KEY")
        if not webhook_secret or not api_key:
            raise HTTPException(
                503,
                "OPENAI_WEBHOOK_SECRET and OPENAI_API_KEY are required for phone calls",
            )

        raw_body = await request.body()
        try:
            event = OpenAI(webhook_secret=webhook_secret).webhooks.unwrap(
                raw_body, request.headers
            )
        except InvalidWebhookSignatureError:
            raise HTTPException(400, "Invalid webhook signature")

        if _event_value(event, "type") != "realtime.call.incoming":
            return JSONResponse({"received": True, "ignored": True})

        event_id = str(_event_value(event, "id", ""))
        data = _event_value(event, "data", {})
        call_id = str(_event_value(data, "call_id", ""))
        sip_headers = _event_value(data, "sip_headers", [])
        if not event_id or not call_id:
            raise HTTPException(400, "Incoming call event is missing an ID or call ID")
        if not store.mark_webhook_processed(event_id):
            return JSONResponse({"received": True, "duplicate": True})

        caller_phone = caller_phone_from_headers(sip_headers)
        store.start_call(call_id, caller_phone)
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                accept_response = await client.post(
                    f"https://api.openai.com/v1/realtime/calls/{call_id}/accept",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json=realtime_session_config(caller_phone),
                )
            if accept_response.is_error:
                raise HTTPException(accept_response.status_code, accept_response.text)
        except Exception:
            store.remove_webhook_event(event_id)
            store.finish_call(
                call_id, case_id=None, transcript="", status="accept_failed"
            )
            raise

        task = asyncio.create_task(monitor_sip_call(store, call_id))
        app.state.call_tasks.add(task)
        task.add_done_callback(app.state.call_tasks.discard)
        return JSONResponse({"received": True, "call_id": call_id})

    return app


app = create_app()
