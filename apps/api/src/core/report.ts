import { z } from "zod";
import type { AgentReport } from "./types.js";

export const AgentReportSchema = z.object({
  category: z.enum(["SUPPORT", "RETURNS", "FINANCE", "GENERAL", "IRRELEVANT"]),
  summary: z.string().min(1).max(600),
  outcome: z.enum(["INFORMATION_FOUND", "INFORMATION_UNAVAILABLE", "ESCALATED", "NO_ACTION_NEEDED"]),
  findings: z.array(z.string().max(300)).max(10),
  suggestedNextStep: z.string().min(1).max(300),
});

/** Extrae y valida el JSON del texto final del modelo (tolera ```json ... ```). */
export function parseAgentReport(text: string): AgentReport | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = AgentReportSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Motivo ESTRUCTURAL por el que un texto final no es un AgentReport válido (rutas y códigos de Zod).
 * Nunca incluye contenido del modelo: es seguro para auditoría.
 */
export function reportIssue(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return "no JSON object found";
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return "JSON.parse failed";
  }
  const result = AgentReportSchema.safeParse(raw);
  if (result.success) return "valid";
  return result.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(root)"}:${i.code}`)
    .join(", ");
}

export interface ExecutedTool {
  tool: string;
  output: unknown;
}

/** Contrasta el informe con los tool results observados. Devuelve el motivo de la discrepancia o null. */
export function checkEvidence(report: AgentReport, executed: ExecutedTool[]): string | null {
  const ran = (name: string) => executed.filter((e) => e.tool === name);
  if (report.outcome === "INFORMATION_FOUND") {
    const foundOrder = ran("getOrderStatus").some(
      (e) => (e.output as { status?: string } | null)?.status !== "NOT_FOUND",
    );
    if (!foundOrder && ran("readInternalDocument").length === 0) {
      return "INFORMATION_FOUND sin una consulta exitosa que lo respalde";
    }
  }
  if (report.outcome === "ESCALATED" && ran("flagForReview").length === 0) {
    return "ESCALATED sin flagForReview ejecutado";
  }
  return null;
}
