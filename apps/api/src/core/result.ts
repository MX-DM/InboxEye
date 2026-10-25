import type { ProcessingResult, Risk, Run } from "./types.js";

/** Construye el contrato uniforme desde la corrida: todo salvo agentReport lo deriva el harness. */
export function toProcessingResult(run: Run): ProcessingResult {
  const inspection = run.events.find((e) => e.eventType === "INSPECTION");
  let risk: Risk = "NOT_ANALYZED";
  if (inspection) {
    const verdict = inspection.detail?.verdict;
    const stub = inspection.detail?.inspector === "stub";
    // Provisional hasta el Input Guard real (Inc. 2): el stub no analiza nada, no cuenta como LOW.
    risk = verdict === "quarantine" ? "HIGH" : stub ? "NOT_ANALYZED" : "LOW";
  }
  return {
    runId: run.id,
    emailId: run.emailId,
    mode: run.mode,
    status: run.status,
    agentReport: run.agentReport,
    security: {
      risk,
      reason: inspection?.reason,
      signals: [],
      deniedActions: run.events.filter((e) => e.decision === "DENY").length,
    },
    events: run.events,
  };
}
