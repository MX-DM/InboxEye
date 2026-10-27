import type { ProcessingResult, Risk, Run } from "./types.js";

/** Construye el contrato uniforme desde la corrida: todo salvo agentReport lo deriva el harness. */
export function toProcessingResult(run: Run): ProcessingResult {
  const sec = run.security;
  // Sin inspección (o con el stub de tests) no hubo análisis: nunca se presenta como LOW.
  const risk: Risk = !sec || sec.inspector === "stub" ? "NOT_ANALYZED" : sec.risk;
  return {
    runId: run.id,
    emailId: run.emailId,
    mode: run.mode,
    status: run.status,
    agentReport: run.agentReport,
    security: {
      risk,
      reason: sec?.reason,
      signals: sec?.signals ?? [],
      deniedActions: run.events.filter((e) => e.decision === "DENY").length,
    },
    events: run.events,
  };
}
