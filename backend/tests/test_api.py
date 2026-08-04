from fastapi.testclient import TestClient
from openai.types.realtime.call_accept_params import CallAcceptParams
from pydantic import TypeAdapter

from src.agent_config import realtime_session_config
from src.main import create_app
from src.store import CaseStore


def complete_case(**overrides):
    payload = {
        "source": "browser_voice",
        "caller_name": "Morgan Lee",
        "company": "North Hall Council",
        "phone": "+1 415 555 0198",
        "email": "morgan@example.test",
        "preferred_contact": "phone",
        "preferred_callback_time": "Today before 17:00 Pacific",
        "site_name": "North Hall Chamber",
        "site_location": "San Francisco, CA",
        "access_constraints": "Security escort required",
        "market": "conference",
        "product_family": "Plixus and CoCon",
        "product_model": "Plixus MME",
        "serial_number": "SN-TEST-1042",
        "software_version": "6.12.0-4",
        "issue_category": "audio",
        "summary": "Delegate microphones have no room audio during a live meeting",
        "symptoms": "Units power on and requests appear, but no audio reaches the room.",
        "error_codes": "Controller status LED amber; no on-screen error",
        "issue_started": "2026-08-04 13:30 Pacific",
        "occurrence": "Constant and reproducible on every tested microphone",
        "affected_scope": "All 28 delegate units in the chamber",
        "operational_impact": "The council meeting cannot continue with the installed system.",
        "safety_risk": False,
        "safety_impact": "No safety impact reported",
        "service_unavailable": True,
        "critical_operation_affected": True,
        "multiple_units_affected": True,
        "time_sensitive_event": True,
        "recent_changes": "CoCon update was installed yesterday",
        "environment_details": "Controller and switches have power; network link LEDs are active",
        "troubleshooting_attempted": "Checked mute state and restarted the control PC once",
        "troubleshooting_results": "No change after either step",
        "evidence_available": "Controller logs and photos of LED states",
        "requested_priority": "low",
        "caller_confirmed": True,
    }
    payload.update(overrides)
    return payload


def test_case_lifecycle_is_durable_and_safety_priority_cannot_be_lowered(tmp_path):
    database = tmp_path / "support.db"
    client = TestClient(create_app(database))

    created_response = client.post("/cases", json=complete_case())
    assert created_response.status_code == 201
    created = created_response.json()
    assert created["id"].startswith("TLV-")
    assert created["priority"] == "critical"
    assert "Critical operation affected" in created["attention_flags"]
    assert created["intake_completeness"] >= 90

    filtered = client.get("/cases", params={"priority": "critical", "q": "North Hall"})
    assert filtered.status_code == 200
    assert filtered.json()["total"] == 1
    assert filtered.json()["items"][0]["id"] == created["id"]

    updated_response = client.patch(
        f"/cases/{created['id']}",
        json={
            "status": "in_progress",
            "assigned_to": "A. Engineer",
            "engineer_notes": "Reviewing controller logs.",
        },
    )
    assert updated_response.status_code == 200
    assert updated_response.json()["status"] == "in_progress"

    transcript = "Caller: The microphones stopped.\nAgent: I have filed the report."
    finalize_response = client.post(
        "/voice/finalize",
        json={
            "case_id": created["id"],
            "transcript": transcript,
            "source": "browser_voice",
        },
    )
    assert finalize_response.status_code == 200
    assert finalize_response.json()["attached"] is True

    # A new repository instance reads the same SQLite record after a restart.
    persisted = CaseStore(database).get_case(created["id"])
    assert persisted is not None
    assert persisted.assigned_to == "A. Engineer"
    assert persisted.transcript == transcript


def test_safety_risk_forces_critical_priority(tmp_path):
    client = TestClient(create_app(tmp_path / "support.db"))
    response = client.post(
        "/cases",
        json=complete_case(
            market="rail",
            product_family="Passenger information system",
            safety_risk=True,
            safety_impact="Caller reports a potentially unsafe operational condition",
            service_unavailable=False,
            critical_operation_affected=False,
            time_sensitive_event=False,
            requested_priority="low",
        ),
    )
    assert response.status_code == 201
    assert response.json()["priority"] == "critical"
    assert "Safety risk reported" in response.json()["attention_flags"]


def test_invalid_case_is_rejected_with_field_details(tmp_path):
    client = TestClient(create_app(tmp_path / "support.db"))
    response = client.post(
        "/cases",
        json={
            "caller_name": "",
            "phone": "12",
            "market": "not-a-market",
        },
    )
    assert response.status_code == 422


def test_duplicate_webhook_ids_are_idempotent(tmp_path):
    store = CaseStore(tmp_path / "support.db")
    assert store.mark_webhook_processed("evt_123") is True
    assert store.mark_webhook_processed("evt_123") is False
    store.remove_webhook_event("evt_123")
    assert store.mark_webhook_processed("evt_123") is True


def test_sip_session_configuration_matches_current_openai_schema():
    config = realtime_session_config("+1 415 555 0100")
    validated = TypeAdapter(CallAcceptParams).validate_python(config)
    assert validated["model"] == "gpt-realtime-2.1"
    assert validated["audio"]["input"]["transcription"]["model"] == "gpt-live-transcribe"
    assert {item["name"] for item in validated["tools"]} == {
        "create_support_case",
        "lookup_case_by_id",
        "lookup_case_by_phone",
    }
