"use client";

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

export default function CaseListPage() {
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCases = async () => {
    try {
      const res = await fetch(`${API_URL}/cases`);
      if (res.ok) {
        const data = await res.json();
        setCases(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCases();
    const interval = setInterval(fetchCases, 1500);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <main className="p-6">
        <p className="text-gray-500">Loading cases...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Cases</h1>
          <p className="mt-1 text-sm text-gray-500">Cases update in real time as they are created.</p>
        </div>
        <Link
          href="/voice"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700"
        >
          Talk to Agent
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50/80">
            <tr>
              <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">Phone</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">Issue</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {cases.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                  No cases yet. Start a voice session to create one.
                </td>
              </tr>
            ) : (
              cases.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <Link href={`/cases/${c.id}`} className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-gray-600">{c.phone}</td>
                  <td className="px-6 py-4 text-gray-600">{c.issue_type}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      c.status === "resolved"
                        ? "bg-green-100 text-green-700"
                        : c.status === "in_progress"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-gray-100 text-gray-700"
                    }`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="max-w-xs truncate px-6 py-4 text-gray-600">{c.notes || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
