"use client";

import { RealtimeAgent, RealtimeSession, tool } from "@openai/agents/realtime";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type TranscriptLine = { role: "user" | "assistant"; text: string };

function normalizeIssueType(raw: string): "missed_service" | "update_request" | "other" {
  const value = raw.toLowerCase().trim().replace("-", "_").replace(" ", "_");
  if (value.includes("missed")) return "missed_service";
  if (value.includes("update")) return "update_request";
  if (value === "missed_service" || value === "update_request" || value === "other") {
    return value;
  }
  return "other";
}

const createCaseTool = tool({
  name: "create_case",
  description: "Create a new customer service case. Use after collecting name, phone, issue type, and description.",
  parameters: z.object({
    name: z.string(),
    phone: z.string(),
    issue_type: z.enum(["missed_service", "update_request", "other"]),
    description: z.string(),
  }),
  async execute({ name, phone, issue_type, description }) {
    const normalizedIssueType = normalizeIssueType(issue_type);
    if (!name.trim() || !phone.trim() || !description.trim()) {
      return "Missing required information. Please collect name, phone number, and short description before creating the case.";
    }
    const res = await fetch(`${API_URL}/cases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        phone: phone.trim(),
        issue_type: normalizedIssueType,
        description: description.trim(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return `Case created. ID: ${data.id}. Status: ${data.status}.`;
    return `Failed to create case: ${res.status}`;
  },
});

const lookupCaseTool = tool({
  name: "lookup_case",
  description: "Look up an existing case by the caller's phone number.",
  parameters: z.object({ phone: z.string() }),
  async execute({ phone }) {
    const res = await fetch(`${API_URL}/cases/by-phone/${encodeURIComponent(phone)}`);
    const data = await res.json().catch(() => null);
    if (res.ok && data) return `Status: ${data.status}. Notes: ${data.notes || "None"}.`;
    return "No case found for that phone number.";
  },
});

const lookupCaseByIdTool = tool({
  name: "lookup_case_by_id",
  description: "Look up an existing case by case ID.",
  parameters: z.object({ case_id: z.string() }),
  async execute({ case_id }) {
    const res = await fetch(`${API_URL}/cases/${encodeURIComponent(case_id)}`);
    const data = await res.json().catch(() => null);
    if (res.ok && data) return `Case ${data.id}. Status: ${data.status}. Notes: ${data.notes || "None"}.`;
    return "No case found for that case ID.";
  },
});

const agent = new RealtimeAgent({
  name: "Customer Service",
  instructions: `You are a friendly customer service voice agent. Help callers by:
1. If caller wants to report an issue, collect exactly: name, phone number, issue type, and short description.
2. Ask for one field at a time and confirm the details briefly.
3. Call create_case exactly once after all four fields are collected.
4. If caller asks for an update, use lookup_case with phone number or lookup_case_by_id with case ID.
Keep responses short and natural for voice.
Issue types: missed_service, update_request, other.`,
  tools: [createCaseTool, lookupCaseTool, lookupCaseByIdTool],
});

function extractText(block: { type?: string; text?: string; transcript?: string | null }): string {
  if (block.type === "input_text" || block.type === "output_text" || block.type === "text") {
    return (block.text || "").trim();
  }
  if (block.type === "input_audio" || block.type === "output_audio") {
    return (block.transcript ?? "").trim();
  }
  return "";
}

function formatHistory(history: unknown[]): TranscriptLine[] {
  const lines: TranscriptLine[] = [];
  for (const item of history) {
    const h = item as { type?: string; role?: string; content?: unknown };
    if (h.type === "message" && (h.role === "user" || h.role === "assistant")) {
      const content = h.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          const t = extractText(c as { type?: string; text?: string; transcript?: string | null });
          if (t) lines.push({ role: h.role as "user" | "assistant", text: t });
        }
      } else if (typeof content === "string" && content.trim()) {
        lines.push({ role: h.role as "user" | "assistant", text: content.trim() });
      }
    }
  }
  return lines;
}

export default function VoicePage() {
  const [session] = useState(() => new RealtimeSession(agent, { model: "gpt-realtime" }));
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "ended" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryAttached, setSummaryAttached] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  useEffect(() => {
    if (status !== "connected") return;
    const refresh = () => {
      const items = "history" in session && Array.isArray((session as { history: unknown[] }).history)
        ? (session as { history: unknown[] }).history
        : [];
      setTranscript(formatHistory(items));
    };
    const onHistoryUpdated = (history: unknown) => {
      const items = Array.isArray(history) ? history : (session as { history?: unknown[] }).history ?? [];
      setTranscript(formatHistory(items));
    };
    const onHistoryAdded = () => refresh();
    session.on("history_updated", onHistoryUpdated);
    session.on("history_added", onHistoryAdded);
    const interval = setInterval(refresh, 500);
    return () => {
      clearInterval(interval);
      if (typeof (session as { off?: (ev: string, fn: (h: unknown) => void) => void }).off === "function") {
        (session as { off: (ev: string, fn: (h: unknown) => void) => void }).off("history_updated", onHistoryUpdated);
        (session as { off: (ev: string, fn: () => void) => void }).off("history_added", onHistoryAdded);
      }
    };
  }, [session, status]);

  const handleStart = useCallback(async () => {
    setStatus("connecting");
    setError(null);
    setTranscript([]);
    setSummary(null);
    setSummaryAttached(false);
    try {
      const res = await fetch(`${API_URL}/voice/token`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const { token } = await res.json();
      await session.connect({ apiKey: token });
      setStatus("connected");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
      setStatus("error");
    }
  }, [session]);

  const handleEndCall = useCallback(async () => {
    const hist = "history" in session ? (session as { history: unknown[] }).history : [];
    const lines = formatHistory(Array.isArray(hist) ? hist : transcript);
    const fullText = lines
      .map((l) => `${l.role === "user" ? "Caller" : "Agent"}: ${l.text}`)
      .join("\n");
    try {
      if (typeof (session as { close?: () => void }).close === "function") {
        (session as { close: () => void }).close();
      }
    } catch {
      /* ignore */
    }
    setStatus("ended");
    setSummaryLoading(true);
    setSummaryAttached(false);
    try {
      const res = await fetch(`${API_URL}/voice/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: fullText || "No transcript." }),
      });
      const data = await res.json().catch(() => ({}));
      setSummary(data.summary || "Summary unavailable.");
      setSummaryAttached(Boolean(data.attached));
    } catch {
      setSummary("Could not generate summary.");
    } finally {
      setSummaryLoading(false);
    }
  }, [session, transcript]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-5">
          <h1 className="text-lg font-semibold text-gray-900">Voice Agent</h1>
          <p className="mt-1 text-sm text-gray-500">
            Start a session to report issues or check case status.
          </p>
        </div>

        <div className="p-6">
          {status === "idle" || status === "error" ? (
            <>
              {error && (
                <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}
              <button
                onClick={handleStart}
                disabled={status === "connecting"}
                className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-60"
              >
                {status === "connecting" ? "Connecting…" : "Start session"}
              </button>
            </>
          ) : status === "connected" ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-sm text-gray-600">
                  <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  Connected
                </span>
                <button
                  onClick={handleEndCall}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
                >
                  End call
                </button>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50/50">
                <div className="border-b border-gray-200 px-4 py-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Live transcript
                  </span>
                </div>
                <div className="max-h-64 overflow-y-auto p-4 space-y-3">
                  {transcript.length === 0 ? (
                    <p className="text-gray-400 text-sm">Conversation will appear here…</p>
                  ) : (
                    transcript.map((l, i) => (
                      <div
                        key={i}
                        className={`flex ${l.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                            l.role === "user"
                              ? "bg-indigo-600 text-white rounded-br-md"
                              : "bg-white border border-gray-200 text-gray-800 rounded-bl-md shadow-sm"
                          }`}
                        >
                          <div className="text-[10px] font-medium opacity-80 mb-0.5">
                            {l.role === "user" ? "You" : "Agent"}
                          </div>
                          <div>{l.text}</div>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={transcriptEndRef} />
                </div>
              </div>
            </div>
          ) : status === "ended" ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                  Call summary
                </h3>
                {summaryLoading ? (
                  <p className="text-gray-500">Generating summary…</p>
                ) : (
                  <>
                    <p className="text-gray-800">{summary}</p>
                    {summaryAttached && (
                      <p className="mt-2 text-xs text-green-600 font-medium">✓ Saved to case</p>
                    )}
                  </>
                )}
              </div>
              {transcript.length > 0 && (
                <details className="rounded-lg border border-gray-200">
                  <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-gray-700">
                    Full transcript
                  </summary>
                  <div className="max-h-48 overflow-y-auto border-t border-gray-200 p-4 space-y-2">
                    {transcript.map((l, i) => (
                      <div
                        key={i}
                        className={`flex ${l.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-sm ${
                            l.role === "user"
                              ? "bg-indigo-600 text-white rounded-br-md"
                              : "bg-gray-100 text-gray-800 rounded-bl-md"
                          }`}
                        >
                          <span className="text-[10px] font-medium opacity-80">{l.role === "user" ? "You" : "Agent"}</span>{" "}
                          {l.text}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              <button
                onClick={handleStart}
                className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Start new session
              </button>
            </div>
          ) : null}
        </div>

        <div className="border-t border-gray-100 px-6 py-3">
          <Link href="/" className="text-sm text-indigo-600 hover:text-indigo-700">
            ← Back to cases
          </Link>
        </div>
      </div>
    </main>
  );
}
