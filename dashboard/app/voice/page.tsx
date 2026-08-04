"use client";

import { RealtimeAgent, RealtimeSession, tool } from "@openai/agents/realtime";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const DEFAULT_MODEL = process.env.NEXT_PUBLIC_OPENAI_REALTIME_MODEL || "gpt-realtime-2.1";
const INTERNAL_START = "[INTERNAL_START_TELEVIC_INTAKE]";

type TranscriptLine = { role: "user" | "assistant"; text: string };
type CallStatus = "idle" | "connecting" | "connected" | "ended" | "error";

const reportParameters = z.object({
  caller_name: z.string(),
  company: z.string(),
  phone: z.string(),
  email: z.string(),
  preferred_contact: z.string(),
  preferred_callback_time: z.string(),
  site_name: z.string(),
  site_location: z.string(),
  access_constraints: z.string(),
  market: z.enum(["conference", "rail", "healthcare", "education", "unknown"]),
  product_family: z.string(),
  product_model: z.string(),
  serial_number: z.string(),
  software_version: z.string(),
  issue_category: z.enum([
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
  ]),
  summary: z.string(),
  symptoms: z.string(),
  error_codes: z.string(),
  issue_started: z.string(),
  occurrence: z.string(),
  affected_scope: z.string(),
  operational_impact: z.string(),
  safety_risk: z.boolean(),
  safety_impact: z.string(),
  service_unavailable: z.boolean(),
  critical_operation_affected: z.boolean(),
  multiple_units_affected: z.boolean(),
  time_sensitive_event: z.boolean(),
  recent_changes: z.string(),
  environment_details: z.string(),
  troubleshooting_attempted: z.string(),
  troubleshooting_results: z.string(),
  evidence_available: z.string(),
  requested_priority: z.enum(["critical", "high", "medium", "low"]),
  caller_confirmed: z.boolean(),
});

const AGENT_INSTRUCTIONS = `
You are the automated Televic Technical Support Intake assistant. Interview the
caller and create an accurate, engineer-ready service report. You are not a
service engineer. Do not diagnose a root cause, invent a troubleshooting step,
or promise an SLA, dispatch, repair, or resolution.

At the start, identify yourself as automated. Explain that their information
and a text transcript will be saved for Televic service engineers, and ask for
permission to continue. Then ask early whether anyone is in immediate danger or
a safety-critical service is unavailable. If there is immediate danger, tell
them to follow site emergency procedures and contact local emergency services
or the responsible on-site safety team. Do not direct them to open, rewire,
dismantle, bypass, or work on equipment. Continue only if it is safe.

Ask one concise question at a time. Use information already provided. Confirm
exact names, phone numbers, case IDs, serial numbers, software versions, and
error codes. Never guess. If unknown, record "Unknown" or "Not provided".

Collect:
1. Full name, organization, confirmed callback number, email or preferred
   contact, and callback window/timezone.
2. Site/project/facility/vehicle name, location, and access restrictions.
3. Televic market, product family, model, serial, and software/firmware version.
4. Exact symptoms versus expected behavior, displayed errors/alarms/LEDs, when
   it began, constant or intermittent pattern, and reproduction details.
5. Units/users/rooms/vehicles affected; service availability; operational and
   safety impact; workaround; and any live or imminent event.
6. Recent changes, relevant power/network/environment observations, safe steps
   already attempted, and the result of each.
7. Available logs, photos, screenshots, recordings, or configuration exports.

Branch your follow-up:
- Conference: microphone/audio, discussion units, voting, interpretation,
  camera tracking, recording, Confero, CoCon, Plixus, D-Cerno, Confidea, Unite,
  network, or power; ask if a meeting is live or imminent and units affected.
- Rail: operator/project and train/fleet/car identifier where permitted;
  passenger information, audio, display, intercom, CCTV, onboard network, seat
  reservation, or control equipment; one vehicle versus fleet and safety impact.
- Healthcare: facility and ward/room/system area, endpoints/users affected, and
  any patient-care or safety workflow impact. Do not provide clinical advice.
- Education: institution, assessment context, live exam status, user count,
  browser/device/network context, and exact on-screen error.

Priority: critical for a reported safety risk or fully unavailable critical
operation; high for a major outage, critical impact, multiple systems, or a
time-sensitive event; medium for material degradation with workaround/limited
scope; low for minor or informational issues. The server can raise priority.

Before filing, read back the contact, site/system, symptom, impact, safety
answer, steps tried, and priority. Ask for corrections and explicit confirmation.
Then call create_support_case exactly once. Read the returned case ID slowly.

For an existing case, use a confirmed case ID or callback number and the lookup
tools. Keep all responses short and natural for voice.
`;

function createAgent(
  onCaseCreated: (caseId: string, priority: string) => void,
  getExistingCaseId: () => string | null,
) {
  const createSupportCase = tool({
    name: "create_support_case",
    description: "Create one confirmed Televic support report after completing the intake and read-back.",
    parameters: reportParameters,
    async execute(arguments_) {
      const existing = getExistingCaseId();
      if (existing) return JSON.stringify({ ok: true, case_id: existing, already_created: true });
      if (!arguments_.caller_confirmed) {
        return JSON.stringify({ ok: false, error: "Read the report back and obtain caller confirmation first." });
      }
      const requiredText = [
        arguments_.caller_name,
        arguments_.phone,
        arguments_.site_name,
        arguments_.product_family,
        arguments_.summary,
        arguments_.symptoms,
        arguments_.operational_impact,
        arguments_.safety_impact,
        arguments_.troubleshooting_attempted,
      ];
      if (requiredText.some((value) => !value.trim())) {
        return JSON.stringify({ ok: false, error: "Required report details are still missing." });
      }
      const response = await fetch(`${API_URL}/cases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...arguments_, source: "browser_voice", call_id: null }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return JSON.stringify({ ok: false, error: "The service report could not be created.", details: data.detail || response.status });
      }
      onCaseCreated(data.id, data.priority);
      return JSON.stringify({ ok: true, case_id: data.id, priority: data.priority, status: data.status });
    },
  });

  const lookupCaseById = tool({
    name: "lookup_case_by_id",
    description: "Look up an existing Televic service report by exact case ID.",
    parameters: z.object({ case_id: z.string() }),
    async execute({ case_id }) {
      const response = await fetch(`${API_URL}/cases/${encodeURIComponent(case_id)}`);
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) return JSON.stringify({ ok: false, error: "No case found for that case ID." });
      return JSON.stringify({ ok: true, case_id: data.id, status: data.status, priority: data.priority, assigned_to: data.assigned_to || "Not yet assigned", updated_at: data.updated_at });
    },
  });

  const lookupCaseByPhone = tool({
    name: "lookup_case_by_phone",
    description: "Look up the latest Televic service report for a confirmed callback phone number.",
    parameters: z.object({ phone: z.string() }),
    async execute({ phone }) {
      const response = await fetch(`${API_URL}/cases/by-phone/${encodeURIComponent(phone)}`);
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) return JSON.stringify({ ok: false, error: "No case found for that phone number." });
      return JSON.stringify({ ok: true, case_id: data.id, status: data.status, priority: data.priority, assigned_to: data.assigned_to || "Not yet assigned", updated_at: data.updated_at });
    },
  });

  return new RealtimeAgent({
    name: "Televic Technical Support Intake",
    instructions: AGENT_INSTRUCTIONS,
    tools: [createSupportCase, lookupCaseById, lookupCaseByPhone],
  });
}

function extractText(block: { type?: string; text?: string; transcript?: string | null }): string {
  if (block.type === "input_text" || block.type === "output_text" || block.type === "text") return (block.text || "").trim();
  if (block.type === "input_audio" || block.type === "output_audio") return (block.transcript || "").trim();
  return "";
}

function formatHistory(history: unknown[]): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const item of history) {
    const message = item as { type?: string; role?: string; content?: unknown };
    if (message.type !== "message" || (message.role !== "user" && message.role !== "assistant")) continue;
    const add = (text: string) => {
      if (text && !text.includes(INTERNAL_START)) lines.push({ role: message.role as "user" | "assistant", text });
    };
    if (Array.isArray(message.content)) {
      for (const content of message.content) add(extractText(content as { type?: string; text?: string; transcript?: string | null }));
    } else if (typeof message.content === "string") add(message.content.trim());
  }
  return lines;
}

export default function VoiceIntakePage() {
  const [session, setSession] = useState<RealtimeSession | null>(null);
  const [status, setStatus] = useState<CallStatus>("idle");
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [casePriority, setCasePriority] = useState<string | null>(null);
  const [finalizeMessage, setFinalizeMessage] = useState("");
  const [finalizing, setFinalizing] = useState(false);
  const caseIdRef = useRef<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  useEffect(() => {
    if (!session || status !== "connected") return;
    const refresh = () => setTranscript(formatHistory(Array.isArray(session.history) ? session.history : []));
    const onHistoryUpdated = (history: unknown) => setTranscript(formatHistory(Array.isArray(history) ? history : session.history));
    const onHistoryAdded = () => refresh();
    session.on("history_updated", onHistoryUpdated);
    session.on("history_added", onHistoryAdded);
    const interval = window.setInterval(refresh, 500);
    return () => {
      window.clearInterval(interval);
      session.off("history_updated", onHistoryUpdated);
      session.off("history_added", onHistoryAdded);
    };
  }, [session, status]);

  const startCall = useCallback(async () => {
    setStatus("connecting");
    setError("");
    setTranscript([]);
    setCaseId(null);
    setCasePriority(null);
    setFinalizeMessage("");
    caseIdRef.current = null;
    try {
      const tokenResponse = await fetch(`${API_URL}/voice/token`, { method: "POST" });
      if (!tokenResponse.ok) throw new Error(await tokenResponse.text());
      const tokenData = await tokenResponse.json();
      if (!tokenData.token) throw new Error("The voice service did not return a session token.");

      const agent = createAgent(
        (createdId, priority) => {
          caseIdRef.current = createdId;
          setCaseId(createdId);
          setCasePriority(priority);
        },
        () => caseIdRef.current,
      );
      const nextSession = new RealtimeSession(agent, { model: tokenData.model || DEFAULT_MODEL });
      await nextSession.connect({ apiKey: tokenData.token });
      setSession(nextSession);
      setStatus("connected");
      nextSession.sendMessage(`${INTERNAL_START} Begin now with the required automated-assistant disclosure, transcript consent question, and safety gate.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Voice connection failed");
      setStatus("error");
    }
  }, []);

  const endCall = useCallback(async () => {
    if (!session) return;
    const lines = formatHistory(Array.isArray(session.history) ? session.history : []);
    setTranscript(lines);
    const fullTranscript = lines.map((line) => `${line.role === "user" ? "Caller" : "Agent"}: ${line.text}`).join("\n");
    try {
      session.close();
    } catch {
      // The transcript and case can still be finalized if the transport already closed.
    }
    setStatus("ended");
    setFinalizing(true);
    try {
      const response = await fetch(`${API_URL}/voice/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ case_id: caseIdRef.current, transcript: fullTranscript, source: "browser_voice" }),
      });
      const data = await response.json().catch(() => ({}));
      setFinalizeMessage(data.message || (response.ok ? "Call finalized." : "Could not finalize the call."));
    } catch {
      setFinalizeMessage("The call ended, but the transcript could not be attached.");
    } finally {
      setFinalizing(false);
      setSession(null);
    }
  }, [session]);

  const phases = ["Safety gate", "Caller & site", "System", "Symptoms & impact", "Read-back & file"];

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <Link href="/" className="text-sm font-medium text-slate-600 hover:text-slate-950">← Engineer queue</Link>
        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Browser test console</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Televic voice intake</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Test the same structured interview used by the support line. Allow microphone access, answer as a client, and confirm the final read-back before a report is filed.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.8fr)]">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
            <div>
              <h2 className="font-semibold text-slate-950">Live support session</h2>
              <p className="mt-0.5 text-xs text-slate-500">Automated intake · engineer review required</p>
            </div>
            {status === "connected" && (
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Live
              </span>
            )}
          </div>

          <div className="p-6">
            {(status === "idle" || status === "error") && (
              <div>
                {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
                <div className="rounded-xl border border-cyan-100 bg-cyan-50/60 p-5">
                  <p className="font-semibold text-slate-900">Before you begin</p>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                    <li>• This test saves a text transcript and structured report.</li>
                    <li>• It is not an emergency service or autonomous diagnosis tool.</li>
                    <li>• The report is filed only after you confirm the read-back.</li>
                  </ul>
                </div>
                <button onClick={startCall} className="mt-5 w-full rounded-lg bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
                  Start voice intake
                </button>
              </div>
            )}

            {status === "connecting" && (
              <div className="grid min-h-72 place-items-center text-center">
                <div>
                  <span className="mx-auto block h-9 w-9 animate-spin rounded-full border-4 border-cyan-100 border-t-cyan-500" />
                  <p className="mt-4 font-medium text-slate-800">Connecting microphone and voice agent…</p>
                </div>
              </div>
            )}

            {status === "connected" && (
              <div className="space-y-4">
                {caseId && (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
                    <span className="font-medium text-emerald-800">Report filed: <span className="font-mono font-bold">{caseId}</span> · {casePriority}</span>
                    <Link href={`/cases/${caseId}`} className="font-semibold text-emerald-800 underline">Open report</Link>
                  </div>
                )}
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/50">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Live transcript</span>
                    <span className="text-xs text-slate-400">Audio is active</span>
                  </div>
                  <div className="max-h-[28rem] min-h-72 space-y-3 overflow-y-auto p-4">
                    {transcript.length === 0 ? (
                      <p className="py-20 text-center text-sm text-slate-400">The assistant is preparing the opening question…</p>
                    ) : transcript.map((line, index) => (
                      <div key={`${index}-${line.text}`} className={`flex ${line.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-sm leading-6 ${line.role === "user" ? "rounded-br-md bg-slate-900 text-white" : "rounded-bl-md border border-slate-200 bg-white text-slate-800 shadow-sm"}`}>
                          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider opacity-60">{line.role === "user" ? "Caller" : "Televic intake"}</p>
                          {line.text}
                        </div>
                      </div>
                    ))}
                    <div ref={transcriptEndRef} />
                  </div>
                </div>
                <button onClick={endCall} className="w-full rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 hover:bg-red-100">End call</button>
              </div>
            )}

            {status === "ended" && (
              <div className="space-y-4">
                <div className={`rounded-xl border p-5 ${caseId ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
                  <p className={`font-semibold ${caseId ? "text-emerald-900" : "text-amber-900"}`}>{caseId ? "Service report saved" : "No service report was filed"}</p>
                  <p className={`mt-1 text-sm ${caseId ? "text-emerald-800" : "text-amber-800"}`}>{finalizing ? "Finalizing transcript…" : finalizeMessage}</p>
                  {caseId && <Link href={`/cases/${caseId}`} className="mt-3 inline-block font-mono text-sm font-bold text-emerald-900 underline">Open {caseId}</Link>}
                </div>
                {transcript.length > 0 && (
                  <details className="rounded-lg border border-slate-200">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700">Review call transcript</summary>
                    <div className="max-h-72 space-y-2 overflow-y-auto border-t border-slate-200 bg-slate-50 p-4">
                      {transcript.map((line, index) => <p key={index} className="text-sm leading-6 text-slate-700"><strong>{line.role === "user" ? "Caller" : "Agent"}:</strong> {line.text}</p>)}
                    </div>
                  </details>
                )}
                <button onClick={startCall} disabled={finalizing} className="w-full rounded-lg bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60">Start another intake</button>
              </div>
            )}
          </div>
        </section>

        <aside className="space-y-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-slate-950">Interview sequence</h2>
            <ol className="mt-4 space-y-3">
              {phases.map((phase, index) => (
                <li key={phase} className="flex items-center gap-3 text-sm text-slate-700">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">{index + 1}</span>
                  {phase}
                </li>
              ))}
            </ol>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-slate-950">Supported Televic markets</h2>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              {['Conference', 'Rail', 'Healthcare', 'Education'].map((market) => <span key={market} className="rounded-lg bg-slate-100 px-3 py-2 text-slate-700">{market}</span>)}
            </div>
          </section>
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
            <h2 className="font-semibold text-amber-950">Safety boundary</h2>
            <p className="mt-2 text-sm leading-6 text-amber-900">The assistant captures observations and prior steps. It does not direct electrical work, disassembly, safety bypasses, or changes to a live critical system.</p>
          </section>
        </aside>
      </div>
    </main>
  );
}
