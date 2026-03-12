# Voice Agent + Case Management Demo

A demo system with an OpenAI Realtime voice agent, FastAPI backend, and Next.js dashboard for customer service case management.

## Architecture

- **Voice Agent** (browser): OpenAI Realtime API via `@openai/agents`. Callers report issues or check case status. The agent uses tools to create/lookup cases via the backend.
- **Backend** (FastAPI): Case CRUD API and ephemeral Realtime token. In-memory storage.
- **Dashboard** (Next.js): Case list, case detail with status/notes editing, and a voice page to talk to the agent.

## Prerequisites

- Python 3.10+
- Node.js 18+
- OpenAI API key

## Setup

### 1. Backend

```bash
cd backend
cp .env.example .env
# Edit .env with OPENAI_API_KEY
pip install -r requirements.txt
uvicorn src.main:app --reload
```

Runs at http://localhost:8000

### 2. Dashboard

```bash
cd dashboard
cp .env.local.example .env.local
# Edit .env.local: NEXT_PUBLIC_API_URL (default http://localhost:8000)
npm install
npm run dev
```

Runs at http://localhost:3000

## Run Order

1. Start backend
2. Start dashboard

## Usage

1. Open http://localhost:3000
2. Click "Talk to Agent" to start a voice session
3. Report an issue (name, phone, issue type, description) or ask for a case update by phone
4. View cases on the dashboard; they update every 5 seconds
5. Open a case to edit status and notes

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /cases | Create case |
| GET | /cases | List cases |
| GET | /cases/{id} | Get one case |
| PATCH | /cases/{id} | Update case (status, notes) |
| GET | /cases/by-phone/{phone} | Lookup by phone |
| POST | /voice/token | Get OpenAI Realtime ephemeral token |

## Env Variables

**Backend**
- `OPENAI_API_KEY` – For Realtime token generation

**Dashboard**
- `NEXT_PUBLIC_API_URL` – Backend URL (default http://localhost:8000)
