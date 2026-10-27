import { describe, expect, it } from "vitest";
import { countByStatus, describeEvent, latestRunByEmail, noReportMessage, statusOf } from "./lib";
import type { ProcessingResult, RunEvent } from "./types";

const run = (emailId: string, status: ProcessingResult["status"], events: RunEvent[] = []): ProcessingResult => ({
  runId: `${emailId}-${status}`,
  emailId,
  mode: "PROTECTED",
  status,
  agentReport: null,
  security: { risk: "LOW", signals: [], deniedActions: 0 },
  events,
});

const ev = (partial: Partial<RunEvent>): RunEvent => ({
  runId: "r",
  emailId: "e",
  ts: "2026-10-27T00:00:00.000Z",
  eventType: "RUN_STARTED",
  ...partial,
});

describe("estado de la bandeja", () => {
  it("un correo sin corridas está PENDING y el último run de cada correo es el vigente", () => {
    const latest = latestRunByEmail([run("a", "FAILED"), run("a", "PROCESSED"), run("b", "QUARANTINED")]);
    expect(statusOf("a", latest)).toBe("PROCESSED");
    expect(statusOf("b", latest)).toBe("QUARANTINED");
    expect(statusOf("c", latest)).toBe("PENDING");
  });

  it("cuenta por estado, incluyendo los pendientes", () => {
    const latest = latestRunByEmail([run("a", "PROCESSED"), run("b", "NEEDS_REVIEW")]);
    const counts = countByStatus(["a", "b", "c", "d"], latest);
    expect(counts).toMatchObject({ PROCESSED: 1, NEEDS_REVIEW: 1, PENDING: 2, QUARANTINED: 0 });
  });
});

describe("describeEvent (solo refleja lo que ocurrió)", () => {
  it("una política DENY se marca como denegada", () => {
    const line = describeEvent(ev({ eventType: "POLICY_DECISION", decision: "DENY", tool: "readInternalDocument", reason: "document not permitted" }));
    expect(line.tone).toBe("deny");
    expect(line.text).toContain("DENEGADA readInternalDocument");
    expect(line.text).toContain("document not permitted");
  });

  it("una política ALLOW se marca como permitida", () => {
    expect(describeEvent(ev({ eventType: "POLICY_DECISION", decision: "ALLOW", tool: "tagEmail" })).tone).toBe("ok");
  });

  it("el Input Guard HIGH es 'deny', LOW es 'ok' y UNKNOWN es 'warn'", () => {
    const tone = (risk: string) =>
      describeEvent(ev({ eventType: "INSPECTION", detail: { risk, inspector: "input-guard" } })).tone;
    expect(tone("HIGH")).toBe("deny");
    expect(tone("LOW")).toBe("ok");
    expect(tone("UNKNOWN")).toBe("warn");
  });

  it("un tipo de evento desconocido no rompe la UI", () => {
    expect(describeEvent(ev({ eventType: "ALGO_NUEVO", reason: "x" })).label).toBe("ALGO_NUEVO");
  });
});

describe("noReportMessage", () => {
  it("explica por qué no hay informe según el estado real", () => {
    expect(noReportMessage(run("a", "QUARANTINED"))).toContain("Input Guard");
    expect(noReportMessage(run("a", "NEEDS_REVIEW"))).toContain("revisión humana");
    expect(noReportMessage(run("a", "PROCESSING"))).toContain("trabajando");
  });

  it("para FAILED incluye el motivo técnico del evento final", () => {
    const failed = run("a", "FAILED", [ev({ eventType: "RUN_FINISHED", reason: "invalid agent report" })]);
    expect(noReportMessage(failed)).toContain("invalid agent report");
  });
});
