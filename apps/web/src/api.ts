import type { EmailDetail, EmailSummary, ProcessingResult } from "./types";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return (await res.json()) as T;
}

export const fetchEmails = () => get<EmailSummary[]>("/emails");
export const fetchEmail = (id: string) => get<EmailDetail>(`/emails/${encodeURIComponent(id)}`);
export const fetchRuns = () => get<ProcessingResult[]>("/runs");
export const fetchRun = (id: string) => get<ProcessingResult>(`/runs/${encodeURIComponent(id)}`);

export async function startRun(emailId: string): Promise<string> {
  const res = await fetch("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ emailId }),
  });
  if (!res.ok) throw new Error(`POST /runs → ${res.status}`);
  return ((await res.json()) as { runId: string }).runId;
}
