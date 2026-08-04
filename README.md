# Televic Voice Support Intake

A voice-assisted troubleshooting intake line for Televic clients. The assistant
asks a guided set of technical questions, applies deterministic safety/priority
rules, and creates a durable service report for an engineer to inspect.

The project supports two call channels:

- **Real phone calls:** a SIP number routes into OpenAI Realtime. A signed
  webhook accepts the call, and a server-side sideband connection executes case
  tools and stores the transcript.
- **Browser test calls:** an engineer can test the same intake flow from the
  dashboard with a microphone and an ephemeral Realtime token.

This is an intake and triage system—not an emergency service, autonomous
diagnostic system, or replacement for a qualified Televic service engineer.

## What the assistant collects

The call begins with an automated-assistant/transcript disclosure and an early
safety gate. It then gathers:

1. Caller, organization, verified callback details, and callback window
2. Affected site/project/facility/vehicle and access constraints
3. Televic market, product family, model, serial, and software/firmware version
4. Exact symptoms, expected behavior, errors/alarms/LEDs, timing, and occurrence
5. Scope, service availability, operational impact, safety impact, and urgency
6. Recent changes, environment, steps already tried, and their results
7. Available logs, photos, screenshots, recordings, or configuration exports
8. A caller-confirmed read-back before the report is filed

Follow-up questions branch across Televic Conference, Rail, Healthcare, and
Education contexts. Unknown details are recorded honestly rather than guessed.

## Safety and priority behavior

- The assistant does not direct disassembly, electrical work, safety bypasses,
  credential sharing, or changes to a live critical system.
- A reported safety risk forces **critical** priority.
- A fully unavailable critical operation also forces **critical** priority.
- A major outage, critical impact, multiple systems, or imminent live event
  receives at least **high** priority.
- These minimums are calculated in backend code; the voice model cannot lower
  them.

## Architecture

| Component | Technology | Responsibility |
| --- | --- | --- |
| Voice intake | OpenAI Realtime + Agents SDK | Guided browser conversation and local tools |
| Phone intake | OpenAI Realtime SIP + sideband WebSocket | Incoming calls, server tools, transcript capture |
| Backend | FastAPI + SQLite | Validation, durable reports, priority rules, signed webhooks |
| Engineer UI | Next.js + Tailwind | Queue, filters, detailed report, assignment, notes, export |

SQLite runs in WAL mode and persists at `backend/data/televic_support.db` by
default. Set `DATABASE_PATH` to change it.

## Local setup

### 1. Backend

```bash
cd backend
cp .env.example .env
# Add OPENAI_API_KEY to .env
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn src.main:app --reload
```

The API runs at `http://localhost:8000`.

### 2. Dashboard

```bash
cd dashboard
cp .env.local.example .env.local
npm ci
npm run dev
```

Open `http://localhost:3000`. Use **Test voice intake** to create a report, then
inspect it in the engineer queue.

## Connect a real support phone number

Real phone activation requires a public HTTPS deployment and a SIP trunking
provider; the repository cannot purchase or configure a phone number for you.

1. Deploy the backend at a stable public HTTPS URL.
2. In the OpenAI project settings, create a webhook for incoming Realtime calls
   that points to:

   ```text
   https://YOUR-BACKEND.example.com/webhooks/openai
   ```

3. Put the webhook signing secret in `OPENAI_WEBHOOK_SECRET`.
4. Find the OpenAI project ID (`proj_...`) and configure the provider's SIP trunk
   destination as:

   ```text
   sip:YOUR_PROJECT_ID@sip.api.openai.com;transport=tls
   ```

5. Route the purchased support number to that trunk and make a test call.

The webhook rejects invalid signatures. Duplicate webhook deliveries are
idempotent. Business logic and case writes run through the server-side sideband
connection, not in the phone client.

## Configuration

### Backend environment

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | Yes | — | Realtime sessions and SIP controls |
| `OPENAI_WEBHOOK_SECRET` | Phone only | — | Verify OpenAI webhook signatures |
| `OPENAI_REALTIME_MODEL` | No | `gpt-realtime-2.1` | Realtime voice model |
| `OPENAI_TRANSCRIPTION_MODEL` | No | `gpt-live-transcribe` | Phone transcript model |
| `OPENAI_REALTIME_VOICE` | No | `marin` | SIP assistant voice |
| `DATABASE_PATH` | No | `data/televic_support.db` | SQLite database path |
| `ALLOWED_ORIGINS` | No | `http://localhost:3000` | Comma-separated dashboard origins |

### Dashboard environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Backend URL |
| `NEXT_PUBLIC_OPENAI_REALTIME_MODEL` | `gpt-realtime-2.1` | Browser voice model fallback |

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Service health |
| `POST` | `/cases` | Create a validated support report |
| `GET` | `/cases` | List/filter/search reports |
| `GET` | `/cases/stats` | Queue counts |
| `GET` | `/cases/{id}` | Detailed report |
| `PATCH` | `/cases/{id}` | Engineer status, priority, owner, and notes |
| `GET` | `/cases/{id}/export` | Download the structured JSON report |
| `POST` | `/voice/token` | Browser Realtime client secret |
| `POST` | `/voice/finalize` | Attach a browser-call transcript |
| `POST` | `/webhooks/openai` | Signed incoming SIP call webhook |

## Tests

```bash
cd backend
pytest -q

cd ../dashboard
npm run build
```

The backend tests cover durable case lifecycle, filtering, transcript attachment,
webhook idempotency, validation, and deterministic priority escalation.

## Before production use

Add organization-approved engineer authentication/authorization, TLS at every
edge, secrets management, encrypted backups, an explicit retention policy,
audit logging, monitoring, and notification/escalation integrations. Review the
opening consent language with counsel for every call jurisdiction. For higher
volume or multi-instance deployment, replace local SQLite with a managed shared
database. Do not expose the engineer API or dashboard directly to the public
Internet without access control.
