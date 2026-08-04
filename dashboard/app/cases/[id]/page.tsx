"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  CaseStatus,
  MARKET_LABELS,
  PRIORITY_LABELS,
  Priority,
  STATUS_LABELS,
  SupportCase,
} from "@/lib/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const priorityStyle: Record<Priority, string> = {
  critical: "border-red-200 bg-red-50 text-red-700",
  high: "border-orange-200 bg-orange-50 text-orange-700",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  low: "border-slate-200 bg-slate-50 text-slate-600",
};

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-6 py-4">
        <h2 className="font-semibold text-slate-950">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}

function Field({ label, value, wide = false }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-900">{value || <span className="text-slate-400">Not provided</span>}</dd>
    </div>
  );
}

function YesNo({ value }: { value: boolean }) {
  return <span className={value ? "font-semibold text-red-700" : "text-slate-700"}>{value ? "Yes" : "No"}</span>;
}

export default function CaseDetailPage() {
  const params = useParams();
  const id = (Array.isArray(params.id) ? params.id[0] : params.id) || "";
  const [item, setItem] = useState<SupportCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<CaseStatus>("new");
  const [priority, setPriority] = useState<Priority>("medium");
  const [assignedTo, setAssignedTo] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const initialized = useRef(false);

  const loadCase = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/cases/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (response.status === 404) {
        setItem(null);
        setError("Case not found");
        return;
      }
      if (!response.ok) throw new Error("Could not load the service report");
      const data = (await response.json()) as SupportCase;
      setItem(data);
      if (!initialized.current) {
        setStatus(data.status);
        setPriority(data.priority);
        setAssignedTo(data.assigned_to || "");
        setNotes(data.engineer_notes || "");
        initialized.current = true;
      }
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the service report");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadCase();
  }, [loadCase]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const response = await fetch(`${API_URL}/cases/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          priority,
          assigned_to: assignedTo,
          engineer_notes: notes,
        }),
      });
      if (!response.ok) throw new Error("Could not save the engineer update");
      const updated = (await response.json()) as SupportCase;
      setItem(updated);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <main className="mx-auto max-w-6xl px-4 py-12 text-sm text-slate-500">Loading service report…</main>;
  }

  if (!item) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <p className="font-semibold text-slate-900">{error || "Case not found"}</p>
          <Link href="/" className="mt-4 inline-block text-sm font-medium text-cyan-700 hover:underline">← Return to engineer queue</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="text-sm font-medium text-slate-600 hover:text-slate-950">← Engineer queue</Link>
        <div className="flex items-center gap-2">
          <button onClick={loadCase} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Refresh</button>
          <a href={`${API_URL}/cases/${encodeURIComponent(item.id)}/export`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Export JSON</a>
        </div>
      </div>

      <header className="rounded-xl bg-slate-950 px-6 py-6 text-white shadow-sm">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold text-cyan-300">{item.id}</span>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${priorityStyle[item.priority]}`}>{PRIORITY_LABELS[item.priority]}</span>
              <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-xs text-slate-200">{STATUS_LABELS[item.status]}</span>
            </div>
            <h1 className="mt-4 max-w-4xl text-2xl font-semibold tracking-tight">{item.summary}</h1>
            <p className="mt-2 text-sm text-slate-400">{item.site_name} · {item.company} · {MARKET_LABELS[item.market]}</p>
          </div>
          <div className="min-w-40 rounded-lg border border-white/10 bg-white/5 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Intake completeness</p>
            <p className="mt-1 text-2xl font-semibold">{item.intake_completeness}%</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-cyan-400" style={{ width: `${item.intake_completeness}%` }} />
            </div>
          </div>
        </div>
      </header>

      {item.attention_flags.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2 rounded-xl border border-red-200 bg-red-50 p-4">
          {item.attention_flags.map((flag) => (
            <span key={flag} className="rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-semibold text-red-700">{flag}</span>
          ))}
        </div>
      )}

      {error && <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
        <div className="space-y-6">
          <Section title="Incident and impact" subtitle="Caller-reported observations; not an engineering diagnosis">
            <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              <Field label="Symptoms" value={item.symptoms} wide />
              <Field label="Error codes / indicators" value={item.error_codes} wide />
              <Field label="Started" value={item.issue_started} />
              <Field label="Occurrence / reproduction" value={item.occurrence} />
              <Field label="Affected scope" value={item.affected_scope} wide />
              <Field label="Operational impact" value={item.operational_impact} wide />
              <Field label="Safety risk" value={<YesNo value={item.safety_risk} />} />
              <Field label="Safety details" value={item.safety_impact} />
              <Field label="Service unavailable" value={<YesNo value={item.service_unavailable} />} />
              <Field label="Critical operation affected" value={<YesNo value={item.critical_operation_affected} />} />
              <Field label="Multiple units / users" value={<YesNo value={item.multiple_units_affected} />} />
              <Field label="Time-sensitive event" value={<YesNo value={item.time_sensitive_event} />} />
            </dl>
          </Section>

          <Section title="Affected system">
            <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              <Field label="Market" value={MARKET_LABELS[item.market]} />
              <Field label="Issue category" value={item.issue_category.replaceAll("_", " ")} />
              <Field label="Product family" value={item.product_family} />
              <Field label="Model / product" value={item.product_model} />
              <Field label="Serial number" value={item.serial_number} />
              <Field label="Software / firmware" value={item.software_version} />
              <Field label="Environment / topology" value={item.environment_details} wide />
            </dl>
          </Section>

          <Section title="Diagnostic context">
            <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              <Field label="Recent changes" value={item.recent_changes} wide />
              <Field label="Steps already attempted" value={item.troubleshooting_attempted} wide />
              <Field label="Results" value={item.troubleshooting_results} wide />
              <Field label="Evidence available" value={item.evidence_available} wide />
            </dl>
          </Section>

          {item.transcript && (
            <Section title="Call transcript" subtitle="Expand for the exact captured conversation">
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-cyan-700">Show full transcript</summary>
                <pre className="mt-4 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-200">{item.transcript}</pre>
              </details>
            </Section>
          )}
        </div>

        <aside className="space-y-6">
          <Section title="Engineer workflow" subtitle="Internal fields are not part of the caller report">
            <div className="space-y-4">
              <label className="block text-sm font-medium text-slate-700">
                Status
                <select value={status} onChange={(event) => setStatus(event.target.value as CaseStatus)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100">
                  {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Priority
                <select value={priority} onChange={(event) => setPriority(event.target.value as Priority)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100">
                  {Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Assigned engineer
                <input value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} placeholder="Name or team" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100" />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Internal engineering notes
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={8} placeholder="Assessment, actions, owner, and next step…" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100" />
              </label>
              <button onClick={save} disabled={saving} className="w-full rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60">
                {saving ? "Saving…" : saved ? "Saved" : "Save engineer update"}
              </button>
            </div>
          </Section>

          <Section title="Caller and site">
            <dl className="space-y-4">
              <Field label="Caller" value={item.caller_name} />
              <Field label="Organization" value={item.company} />
              <Field label="Phone" value={<a href={`tel:${item.phone}`} className="text-cyan-700 hover:underline">{item.phone}</a>} />
              <Field label="Email" value={item.email ? <a href={`mailto:${item.email}`} className="break-all text-cyan-700 hover:underline">{item.email}</a> : null} />
              <Field label="Preferred contact" value={item.preferred_contact} />
              <Field label="Callback window" value={item.preferred_callback_time} />
              <Field label="Site" value={item.site_name} />
              <Field label="Location" value={item.site_location} />
              <Field label="Access constraints" value={item.access_constraints} />
            </dl>
          </Section>

          <Section title="Report metadata">
            <dl className="space-y-4">
              <Field label="Source" value={item.source.replaceAll("_", " ")} />
              <Field label="Realtime call ID" value={item.call_id} />
              <Field label="Caller confirmed read-back" value={item.caller_confirmed ? "Yes" : "No"} />
              <Field label="Created" value={new Date(item.created_at).toLocaleString()} />
              <Field label="Last updated" value={new Date(item.updated_at).toLocaleString()} />
            </dl>
          </Section>
        </aside>
      </div>
    </main>
  );
}
