// Espejo mínimo del contrato de la API (apps/api/src/core/types.ts). Se duplica a propósito: sin paquete compartido.
export type RunStatus = "PROCESSING" | "PROCESSED" | "NEEDS_REVIEW" | "QUARANTINED" | "FAILED";
/** Estado que muestra la bandeja: un correo sin corridas está PENDING. */
export type UiStatus = "PENDING" | RunStatus;
export type Risk = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN" | "NOT_ANALYZED";

export interface AgentReport {
  category: string;
  summary: string;
  outcome: string;
  findings: string[];
  suggestedNextStep: string;
}

export interface RunEvent {
  runId: string;
  emailId: string;
  ts: string;
  eventType: string;
  tool?: string;
  decision?: "ALLOW" | "DENY";
  reason?: string;
  detail?: Record<string, string | number | boolean>;
}

export interface ProcessingResult {
  runId: string;
  emailId: string;
  mode: string;
  status: RunStatus;
  agentReport: AgentReport | null;
  security: { risk: Risk; reason?: string; signals: string[]; deniedActions: number };
  events: RunEvent[];
}

export interface EmailSummary {
  id: string;
  from: string;
  subject: string;
}

export interface EmailDetail extends EmailSummary {
  body: string;
}
