export type Market = "conference" | "rail" | "healthcare" | "education" | "unknown";
export type Priority = "critical" | "high" | "medium" | "low";
export type CaseStatus =
  | "new"
  | "triaged"
  | "in_progress"
  | "waiting_customer"
  | "resolved"
  | "closed";

export type SupportCase = {
  id: string;
  source: "browser_voice" | "phone" | "api";
  call_id: string | null;
  caller_name: string;
  company: string;
  phone: string;
  email: string | null;
  preferred_contact: string | null;
  preferred_callback_time: string | null;
  site_name: string;
  site_location: string | null;
  access_constraints: string | null;
  market: Market;
  product_family: string;
  product_model: string | null;
  serial_number: string | null;
  software_version: string | null;
  issue_category: string;
  summary: string;
  symptoms: string;
  error_codes: string | null;
  issue_started: string | null;
  occurrence: string;
  affected_scope: string;
  operational_impact: string;
  safety_risk: boolean;
  safety_impact: string;
  service_unavailable: boolean;
  critical_operation_affected: boolean;
  multiple_units_affected: boolean;
  time_sensitive_event: boolean;
  recent_changes: string | null;
  environment_details: string | null;
  troubleshooting_attempted: string;
  troubleshooting_results: string | null;
  evidence_available: string | null;
  requested_priority: Priority;
  caller_confirmed: boolean;
  priority: Priority;
  status: CaseStatus;
  assigned_to: string;
  engineer_notes: string;
  transcript: string;
  intake_completeness: number;
  attention_flags: string[];
  created_at: string;
  updated_at: string;
};

export type CaseListResponse = {
  items: SupportCase[];
  total: number;
};

export type CaseStats = {
  total: number;
  by_status: Partial<Record<CaseStatus, number>>;
  by_priority: Partial<Record<Priority, number>>;
};

export const MARKET_LABELS: Record<Market, string> = {
  conference: "Conference",
  rail: "Rail",
  healthcare: "Healthcare",
  education: "Education",
  unknown: "Unknown",
};

export const STATUS_LABELS: Record<CaseStatus, string> = {
  new: "New",
  triaged: "Triaged",
  in_progress: "In progress",
  waiting_customer: "Waiting for customer",
  resolved: "Resolved",
  closed: "Closed",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};
