"""Small, durable SQLite repository for Televic support cases."""

from __future__ import annotations

import json
import re
import secrets
import sqlite3
from datetime import datetime
from pathlib import Path

from .models import (
    CaseCreate,
    CaseListResponse,
    CaseRecord,
    CaseUpdate,
    new_case_record,
    utc_now,
)


def normalize_phone(value: str) -> str:
    digits = re.sub(r"\D", "", value or "")
    return digits[-15:]


class CaseStore:
    def __init__(self, database_path: str | Path):
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS cases (
                    id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    priority TEXT NOT NULL,
                    market TEXT NOT NULL,
                    source TEXT NOT NULL,
                    caller_name TEXT NOT NULL,
                    company TEXT NOT NULL,
                    phone_normalized TEXT NOT NULL,
                    site_name TEXT NOT NULL,
                    product_family TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    assigned_to TEXT NOT NULL DEFAULT '',
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_cases_updated
                    ON cases(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_cases_filters
                    ON cases(status, priority, market);
                CREATE INDEX IF NOT EXISTS idx_cases_phone
                    ON cases(phone_normalized, created_at DESC);

                CREATE TABLE IF NOT EXISTS webhook_events (
                    event_id TEXT PRIMARY KEY,
                    processed_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS call_sessions (
                    call_id TEXT PRIMARY KEY,
                    caller_phone TEXT NOT NULL DEFAULT '',
                    case_id TEXT,
                    status TEXT NOT NULL,
                    transcript TEXT NOT NULL DEFAULT '',
                    started_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY(case_id) REFERENCES cases(id)
                );
                """
            )

    @staticmethod
    def _case_id(now: datetime) -> str:
        return f"TLV-{now:%y%m%d}-{secrets.token_hex(2).upper()}"

    @staticmethod
    def _record_from_row(row: sqlite3.Row | None) -> CaseRecord | None:
        if row is None:
            return None
        return CaseRecord.model_validate_json(row["payload"])

    def create_case(self, payload: CaseCreate) -> CaseRecord:
        for _ in range(8):
            record = new_case_record(self._case_id(utc_now()), payload)
            try:
                with self._connect() as connection:
                    connection.execute(
                        """
                        INSERT INTO cases (
                            id, status, priority, market, source, caller_name,
                            company, phone_normalized, site_name, product_family,
                            summary, assigned_to, payload, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            record.id,
                            record.status,
                            record.priority,
                            record.market,
                            record.source,
                            record.caller_name,
                            record.company,
                            normalize_phone(record.phone),
                            record.site_name,
                            record.product_family,
                            record.summary,
                            record.assigned_to,
                            record.model_dump_json(),
                            record.created_at.isoformat(),
                            record.updated_at.isoformat(),
                        ),
                    )
                return record
            except sqlite3.IntegrityError:
                continue
        raise RuntimeError("Could not allocate a unique case ID")

    def get_case(self, case_id: str) -> CaseRecord | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT payload FROM cases WHERE id = ?",
                (case_id.strip().upper(),),
            ).fetchone()
        return self._record_from_row(row)

    def get_latest_by_phone(self, phone: str) -> CaseRecord | None:
        normalized = normalize_phone(phone)
        if not normalized:
            return None
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT payload FROM cases
                WHERE phone_normalized = ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (normalized,),
            ).fetchone()
        return self._record_from_row(row)

    def list_cases(
        self,
        *,
        status: str | None = None,
        priority: str | None = None,
        market: str | None = None,
        query: str | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> CaseListResponse:
        where: list[str] = []
        values: list[object] = []
        if status:
            where.append("status = ?")
            values.append(status)
        if priority:
            where.append("priority = ?")
            values.append(priority)
        if market:
            where.append("market = ?")
            values.append(market)
        if query and query.strip():
            search = f"%{query.strip().lower()}%"
            where.append(
                """(
                    lower(id) LIKE ? OR lower(caller_name) LIKE ? OR
                    lower(company) LIKE ? OR lower(site_name) LIKE ? OR
                    lower(product_family) LIKE ? OR lower(summary) LIKE ?
                )"""
            )
            values.extend([search] * 6)

        clause = " WHERE " + " AND ".join(where) if where else ""
        priority_order = (
            "CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 "
            "WHEN 'medium' THEN 2 ELSE 3 END"
        )
        with self._connect() as connection:
            total = connection.execute(
                f"SELECT COUNT(*) AS count FROM cases{clause}", values
            ).fetchone()["count"]
            rows = connection.execute(
                f"""
                SELECT payload FROM cases{clause}
                ORDER BY {priority_order}, updated_at DESC
                LIMIT ? OFFSET ?
                """,
                [*values, limit, offset],
            ).fetchall()
        return CaseListResponse(
            items=[CaseRecord.model_validate_json(row["payload"]) for row in rows],
            total=total,
        )

    def update_case(self, case_id: str, update: CaseUpdate) -> CaseRecord | None:
        current = self.get_case(case_id)
        if current is None:
            return None
        changes = update.model_dump(exclude_none=True)
        changes["updated_at"] = utc_now()
        updated = CaseRecord.model_validate({**current.model_dump(), **changes})
        self._save(updated)
        return updated

    def attach_transcript(self, case_id: str, transcript: str) -> CaseRecord | None:
        current = self.get_case(case_id)
        if current is None:
            return None
        clean = transcript.strip()
        if not clean:
            return current
        if current.transcript and clean not in current.transcript:
            clean = f"{current.transcript.rstrip()}\n\n--- Additional call record ---\n{clean}"
        updated = CaseRecord.model_validate(
            {
                **current.model_dump(),
                "transcript": clean,
                "updated_at": utc_now(),
            }
        )
        self._save(updated)
        return updated

    def _save(self, record: CaseRecord) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE cases SET
                    status = ?, priority = ?, market = ?, source = ?,
                    caller_name = ?, company = ?, phone_normalized = ?,
                    site_name = ?, product_family = ?, summary = ?,
                    assigned_to = ?, payload = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    record.status,
                    record.priority,
                    record.market,
                    record.source,
                    record.caller_name,
                    record.company,
                    normalize_phone(record.phone),
                    record.site_name,
                    record.product_family,
                    record.summary,
                    record.assigned_to,
                    record.model_dump_json(),
                    record.updated_at.isoformat(),
                    record.id,
                ),
            )

    def summary_counts(self) -> dict[str, object]:
        with self._connect() as connection:
            status_rows = connection.execute(
                "SELECT status, COUNT(*) AS count FROM cases GROUP BY status"
            ).fetchall()
            priority_rows = connection.execute(
                "SELECT priority, COUNT(*) AS count FROM cases GROUP BY priority"
            ).fetchall()
            total = connection.execute("SELECT COUNT(*) AS count FROM cases").fetchone()[
                "count"
            ]
        return {
            "total": total,
            "by_status": {row["status"]: row["count"] for row in status_rows},
            "by_priority": {
                row["priority"]: row["count"] for row in priority_rows
            },
        }

    def mark_webhook_processed(self, event_id: str) -> bool:
        """Return False for a duplicate webhook delivery."""

        try:
            with self._connect() as connection:
                connection.execute(
                    "INSERT INTO webhook_events(event_id, processed_at) VALUES (?, ?)",
                    (event_id, utc_now().isoformat()),
                )
            return True
        except sqlite3.IntegrityError:
            return False

    def remove_webhook_event(self, event_id: str) -> None:
        """Allow a failed webhook action to be retried by OpenAI."""

        with self._connect() as connection:
            connection.execute(
                "DELETE FROM webhook_events WHERE event_id = ?", (event_id,)
            )

    def start_call(self, call_id: str, caller_phone: str) -> None:
        now = utc_now().isoformat()
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO call_sessions(
                    call_id, caller_phone, status, started_at, updated_at
                ) VALUES (?, ?, 'connected', ?, ?)
                ON CONFLICT(call_id) DO UPDATE SET
                    caller_phone = excluded.caller_phone,
                    status = 'connected',
                    updated_at = excluded.updated_at
                """,
                (call_id, caller_phone, now, now),
            )

    def finish_call(
        self,
        call_id: str,
        *,
        case_id: str | None,
        transcript: str,
        status: str = "completed",
    ) -> None:
        now = utc_now().isoformat()
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE call_sessions SET
                    case_id = ?, status = ?, transcript = ?, updated_at = ?
                WHERE call_id = ?
                """,
                (case_id, status, transcript, now, call_id),
            )
        if case_id and transcript.strip():
            self.attach_transcript(case_id, transcript)

    def export_case(self, case_id: str) -> dict[str, object] | None:
        record = self.get_case(case_id)
        if record is None:
            return None
        return json.loads(record.model_dump_json())
