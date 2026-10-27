import type { ProcessingResult, RunEvent, UiStatus } from "./types";

export const STATUS_LABEL: Record<UiStatus, string> = {
  PENDING: "Pendiente",
  PROCESSING: "Procesando",
  PROCESSED: "Procesado",
  NEEDS_REVIEW: "Requiere revisión",
  QUARANTINED: "En cuarentena",
  FAILED: "Falló",
};

/** La API devuelve los runs en orden de creación: el último de cada correo es el vigente. */
export function latestRunByEmail(runs: ProcessingResult[]): Map<string, ProcessingResult> {
  const map = new Map<string, ProcessingResult>();
  for (const run of runs) map.set(run.emailId, run);
  return map;
}

export function statusOf(emailId: string, latest: Map<string, ProcessingResult>): UiStatus {
  return latest.get(emailId)?.status ?? "PENDING";
}

export function countByStatus(emailIds: string[], latest: Map<string, ProcessingResult>): Record<UiStatus, number> {
  const counts: Record<UiStatus, number> = {
    PENDING: 0,
    PROCESSING: 0,
    PROCESSED: 0,
    NEEDS_REVIEW: 0,
    QUARANTINED: 0,
    FAILED: 0,
  };
  for (const id of emailIds) counts[statusOf(id, latest)]++;
  return counts;
}

export type Tone = "info" | "ok" | "deny" | "warn";

export interface TraceLine {
  label: string;
  text: string;
  tone: Tone;
}

/** Traduce un evento de auditoría a una línea legible. Solo usa campos del evento; no inventa nada. */
export function describeEvent(e: RunEvent): TraceLine {
  const d = e.detail ?? {};
  const why = e.reason ? ` — ${e.reason}` : "";
  switch (e.eventType) {
    case "RUN_STARTED":
      return { label: "Inicio", text: "Corrida iniciada (el agente solo recibe el ID del correo).", tone: "info" };
    case "LLM_CALL":
      return {
        label: "Agente",
        text: `Llamada a Claude (paso ${d.step}) · ${d.input}→${d.output} tokens · stop: ${d.stop}`,
        tone: "info",
      };
    case "TOOL_PROPOSED":
      return { label: "Agente", text: `Pidió la herramienta ${e.tool}`, tone: "info" };
    case "POLICY_DECISION":
      return e.decision === "DENY"
        ? { label: "Política", text: `DENEGADA ${e.tool}${why}`, tone: "deny" }
        : { label: "Política", text: `Permitida ${e.tool}`, tone: "ok" };
    case "TOOL_EXECUTED":
      return e.reason
        ? { label: "Tool", text: `${e.tool} falló (${e.reason})`, tone: "warn" }
        : { label: "Tool", text: `Ejecutada ${e.tool}`, tone: "ok" };
    case "INSPECTION":
      return {
        label: "Input Guard",
        text: `Riesgo ${d.risk} (${d.inspector})${why}`,
        tone: d.risk === "LOW" ? "ok" : d.risk === "HIGH" ? "deny" : "warn",
      };
    case "REPORT_CHECK":
      return { label: "Informe", text: e.reason ?? "Revisión del informe", tone: "warn" };
    case "RUN_FINISHED":
      return {
        label: "Fin",
        text: `Estado final: ${d.status}${why}`,
        tone: d.status === "PROCESSED" ? "ok" : d.status === "FAILED" ? "deny" : "warn",
      };
    default:
      return { label: e.eventType, text: why.replace(/^ — /, ""), tone: "info" };
  }
}

/** Por qué no hay AgentReport, según el estado real de la corrida. */
export function noReportMessage(run: ProcessingResult): string {
  if (run.status === "PROCESSING") return "El agente todavía está trabajando.";
  if (run.status === "QUARANTINED") return "Sin informe: el Input Guard retuvo el contenido antes de que llegara al agente.";
  if (run.status === "NEEDS_REVIEW") return "Sin informe: el contenido se retuvo y se derivó a revisión humana.";
  const fin = [...run.events].reverse().find((e) => e.eventType === "RUN_FINISHED");
  return `Sin informe: la corrida falló${fin?.reason ? ` (${fin.reason})` : ""}.`;
}
