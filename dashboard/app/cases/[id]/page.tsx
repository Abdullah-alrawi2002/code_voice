"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";

type Case = {
  id: string;
  name: string;
  phone: string;
  issue_type: string;
  description: string;
  status: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const LABELS: Record<string, string> = {
  missed_service: "Missed service",
  update_request: "Update request",
  other: "Other",
};

export default function CaseDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [c, setC] = useState<Case | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusEdit, setStatusEdit] = useState("");
  const [notesEdit, setNotesEdit] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchCase = async () => {
    try {
      const res = await fetch(`${API_URL}/cases/${id}`);
      if (res.ok) {
        const data = await res.json();
        setC(data);
        setStatusEdit(data.status);
        setNotesEdit(data.notes || "");
      } else if (res.status === 404) {
        setC(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCase();
    const interval = setInterval(fetchCase, 1500);
    return () => clearInterval(interval);
  }, [id]);

  const handleSave = async () => {
    if (!c) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/cases/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: statusEdit !== c.status ? statusEdit : undefined,
          notes: notesEdit !== (c.notes || "") ? notesEdit : undefined,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setC(updated);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <div className="animate-pulse rounded-xl border border-gray-200 bg-white p-8">
          <div className="h-6 w-48 rounded bg-gray-200" />
          <div className="mt-4 h-4 w-full rounded bg-gray-100" />
        </div>
      </main>
    );
  }

  if (!c) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-gray-500">Case not found.</p>
          <Link href="/" className="mt-4 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-700">
            ← Back to cases
          </Link>
        </div>
      </main>
    );
  }

  const statusBadge =
    c.status === "resolved"
      ? "bg-green-100 text-green-700"
      : c.status === "in_progress"
        ? "bg-amber-100 text-amber-800"
        : "bg-gray-100 text-gray-700";

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900"
      >
        ← Back to cases
      </Link>

      <div className="space-y-6">
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold text-gray-900">{c.name}</h1>
                <p className="mt-1 text-sm text-gray-500">
                  Case {c.id.slice(0, 8)} • Updates in real time
                </p>
              </div>
              <span
                className={`inline-flex shrink-0 rounded-full px-3 py-1 text-xs font-medium ${statusBadge}`}
              >
                {c.status.replace("_", " ")}
              </span>
            </div>
          </div>
          <dl className="grid gap-0 sm:grid-cols-2">
            <div className="border-b border-gray-100 px-6 py-4 sm:border-b-0 sm:border-r">
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Phone</dt>
              <dd className="mt-0.5 font-medium text-gray-900">{c.phone}</dd>
            </div>
            <div className="border-b border-gray-100 px-6 py-4">
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Issue type</dt>
              <dd className="mt-0.5 font-medium text-gray-900">{LABELS[c.issue_type] ?? c.issue_type}</dd>
            </div>
            <div className="border-t border-gray-100 px-6 py-4 sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Description</dt>
              <dd className="mt-0.5 text-gray-900">{c.description}</dd>
            </div>
            <div className="border-t border-gray-100 px-6 py-4">
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Created</dt>
              <dd className="mt-0.5 text-gray-700">
                {new Date(c.created_at).toLocaleString()}
              </dd>
            </div>
            <div className="border-t border-gray-100 px-6 py-4">
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">Last updated</dt>
              <dd className="mt-0.5 text-gray-700">
                {new Date(c.updated_at).toLocaleString()}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">Update case</h2>
          <p className="mt-1 text-sm text-gray-500">Change status or add notes. Changes appear in real time.</p>
          <div className="mt-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Status</label>
              <select
                value={statusEdit}
                onChange={(e) => setStatusEdit(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="new">New</option>
                <option value="in_progress">In progress</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Notes</label>
              <textarea
                value={notesEdit}
                onChange={(e) => setNotesEdit(e.target.value)}
                rows={3}
                placeholder="Add staff notes..."
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
