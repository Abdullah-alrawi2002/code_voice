"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CaseListResponse,
  CaseStats,
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

const statusDot: Record<string, string> = {
  new: "bg-cyan-500",
  triaged: "bg-violet-500",
  in_progress: "bg-amber-500",
  waiting_customer: "bg-slate-400",
  resolved: "bg-emerald-500",
  closed: "bg-slate-700",
};

export default function EngineerQueuePage() {
  const [cases, setCases] = useState<SupportCase[]>([]);
  const [stats, setStats] = useState<CaseStats>({ total: 0, by_status: {}, by_priority: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState("all");
  const [status, setStatus] = useState("all");
  const [market, setMarket] = useState("all");

  const refresh = useCallback(async () => {
    try {
      const [caseResponse, statResponse] = await Promise.all([
        fetch(`${API_URL}/cases`, { cache: "no-store" }),
        fetch(`${API_URL}/cases/stats`, { cache: "no-store" }),
      ]);
      if (!caseResponse.ok || !statResponse.ok) throw new Error("Service API is unavailable");
      const caseData = (await caseResponse.json()) as CaseListResponse;
      const statData = (await statResponse.json()) as CaseStats;
      setCases(caseData.items);
      setStats(statData);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load cases");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = window.setInterval(refresh, 5000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const filteredCases = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cases.filter((item) => {
      const searchText = [
        item.id,
        item.caller_name,
        item.company,
        item.site_name,
        item.product_family,
        item.summary,
      ]
        .join(" ")
        .toLowerCase();
      return (
        (!needle || searchText.includes(needle)) &&
        (priority === "all" || item.priority === priority) &&
        (status === "all" || item.status === status) &&
        (market === "all" || item.market === market)
      );
    });
  }, [cases, market, priority, query, status]);

  const activeCount = (stats.by_status.triaged || 0) + (stats.by_status.in_progress || 0);
  const cards = [
    { label: "Open reports", value: stats.total - (stats.by_status.closed || 0), tone: "text-slate-950" },
    { label: "Critical", value: stats.by_priority.critical || 0, tone: "text-red-600" },
    { label: "In engineering", value: activeCount, tone: "text-amber-600" },
    { label: "Waiting on client", value: stats.by_status.waiting_customer || 0, tone: "text-slate-600" },
  ];

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Technical support</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Engineer queue</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Structured reports from browser and phone intake. Critical cases are always shown first.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Refreshes every 5 seconds
          <button onClick={refresh} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100">
            Refresh now
          </button>
        </div>
      </div>

      <section className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{card.label}</p>
            <p className={`mt-2 text-3xl font-semibold tabular-nums ${card.tone}`}>{card.value}</p>
          </div>
        ))}
      </section>

      <section className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-3 border-b border-slate-200 bg-slate-50/80 p-4 md:grid-cols-[minmax(220px,1fr)_repeat(3,170px)]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search case, client, site, product, or symptom…"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
          />
          <select value={priority} onChange={(event) => setPriority(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-500">
            <option value="all">All priorities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-500">
            <option value="all">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select value={market} onChange={(event) => setMarket(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-500">
            <option value="all">All markets</option>
            {Object.entries(MARKET_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        {error && <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700">{error}</div>}

        <div className="hidden overflow-x-auto md:block">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-white">
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="px-5 py-3">Priority</th>
                <th className="px-5 py-3">Case / site</th>
                <th className="px-5 py-3">System</th>
                <th className="px-5 py-3">Incident</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCases.map((item) => (
                <tr key={item.id} className="align-top hover:bg-slate-50/80">
                  <td className="px-5 py-4">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${priorityStyle[item.priority]}`}>
                      {PRIORITY_LABELS[item.priority]}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <Link href={`/cases/${item.id}`} className="font-mono text-xs font-semibold text-cyan-700 hover:text-cyan-900 hover:underline">
                      {item.id}
                    </Link>
                    <p className="mt-1 font-medium text-slate-900">{item.site_name}</p>
                    <p className="text-xs text-slate-500">{item.company}</p>
                  </td>
                  <td className="px-5 py-4">
                    <p className="text-sm font-medium text-slate-800">{MARKET_LABELS[item.market]}</p>
                    <p className="mt-0.5 max-w-[190px] truncate text-xs text-slate-500">{item.product_family}</p>
                  </td>
                  <td className="max-w-sm px-5 py-4">
                    <Link href={`/cases/${item.id}`} className="line-clamp-2 text-sm font-medium text-slate-900 hover:text-cyan-800">
                      {item.summary}
                    </Link>
                    <p className="mt-1 text-xs text-slate-500">{item.intake_completeness}% intake complete</p>
                  </td>
                  <td className="px-5 py-4">
                    <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm text-slate-700">
                      <span className={`h-2 w-2 rounded-full ${statusDot[item.status]}`} />
                      {STATUS_LABELS[item.status]}
                    </span>
                    {item.assigned_to && <p className="mt-1 text-xs text-slate-500">{item.assigned_to}</p>}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-right text-xs text-slate-500">
                    {new Date(item.updated_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-slate-100 md:hidden">
          {filteredCases.map((item) => (
            <Link key={item.id} href={`/cases/${item.id}`} className="block p-4 hover:bg-slate-50">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs font-semibold text-cyan-700">{item.id}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${priorityStyle[item.priority]}`}>{PRIORITY_LABELS[item.priority]}</span>
              </div>
              <p className="mt-2 font-semibold text-slate-900">{item.summary}</p>
              <p className="mt-1 text-sm text-slate-500">{item.site_name} · {MARKET_LABELS[item.market]}</p>
              <p className="mt-2 text-xs text-slate-500">{STATUS_LABELS[item.status]} · {new Date(item.updated_at).toLocaleString()}</p>
            </Link>
          ))}
        </div>

        {!loading && filteredCases.length === 0 && (
          <div className="px-6 py-14 text-center">
            <p className="font-medium text-slate-700">No reports match these filters.</p>
            <p className="mt-1 text-sm text-slate-500">New voice reports will appear here automatically.</p>
          </div>
        )}
        {loading && <div className="px-6 py-14 text-center text-sm text-slate-500">Loading engineer queue…</div>}
      </section>
    </main>
  );
}
