import type { z } from "zod";

export type RunMode = "PROTECTED" | "UNPROTECTED_DEMO";
export type FinalStatus = "PROCESSED" | "NEEDS_REVIEW" | "QUARANTINED" | "FAILED";
export type RunStatus = "PROCESSING" | FinalStatus;
export type Risk = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN" | "NOT_ANALYZED";

/** Informe interno producido por Claude. Es lo único que el modelo decide del resultado final. */
export interface AgentReport {
  category: "SUPPORT" | "RETURNS" | "FINANCE" | "GENERAL" | "IRRELEVANT";
  summary: string;
  outcome: "INFORMATION_FOUND" | "INFORMATION_UNAVAILABLE" | "ESCALATED" | "NO_ACTION_NEEDED";
  findings: string[];
  suggestedNextStep: string;
}

/** Contrato uniforme hacia el frontend: estado, seguridad y eventos los genera el harness. */
export interface ProcessingResult {
  runId: string;
  emailId: string;
  mode: RunMode;
  status: RunStatus;
  agentReport: AgentReport | null;
  security: { risk: Risk; reason?: string; signals: string[]; deniedActions: number };
  events: RunEvent[];
}

export type EventType =
  | "RUN_STARTED"
  | "LLM_CALL"
  | "TOOL_PROPOSED"
  | "POLICY_DECISION"
  | "TOOL_EXECUTED"
  | "INSPECTION"
  | "REPORT_CHECK"
  | "RUN_FINISHED";

/** Auditoría append-only. Nunca incluye cuerpos de correo ni secretos. */
export interface RunEvent {
  runId: string;
  emailId: string;
  ts: string;
  eventType: EventType;
  tool?: string;
  decision?: "ALLOW" | "DENY";
  reason?: string;
  detail?: Record<string, string | number | boolean>;
}

/** Efectos sintéticos de las tools de escritura. Viven en la corrida (no son globales) para aislar runs. */
export interface RunEffects {
  tags: { emailId: string; category: string }[];
  reviews: { emailId: string; reason: string }[];
}

/** Resultado del Input Guard. `reason`/`signals` derivan de contenido externo: solo para UI/auditoría, nunca al agente. */
export interface RunSecurity {
  risk: Risk;
  reason?: string;
  signals: string[];
  inspector: string;
}

export interface Run {
  id: string;
  emailId: string;
  mode: RunMode;
  status: RunStatus;
  agentReport: AgentReport | null;
  security?: RunSecurity;
  /** Motivo técnico si terminó FAILED (sin contenido de correos). */
  failureReason?: string;
  tokens: { input: number; output: number };
  events: RunEvent[];
  effects: RunEffects;
}

export interface RunContext {
  runId: string;
  emailId: string;
  effects: RunEffects;
}

/** Llamada a herramienta propuesta por el modelo (no confiable hasta validar). */
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export type PolicyDecision =
  | { kind: "ALLOW" }
  | { kind: "DENY"; reason: string };

/**
 * Herramienta registrada por la empresa. Los metadatos son declarativos:
 * el PolicyEngine los interpreta, el handler solo ejecuta.
 */
export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  input: S;
  /** El resultado proviene de contenido externo: pasa por el inspector antes de volver al LLM. */
  external?: boolean;
  /** Parámetro que debe coincidir con el emailId asignado a la corrida. */
  scopeToRunEmail?: string;
  /** Regla de recurso determinista (Action Guard). Devuelve el motivo del rechazo, o null si permite. */
  allow?: (input: z.infer<S>, ctx: RunContext) => string | null;
  handler: (input: z.infer<S>, ctx: RunContext) => Promise<unknown>;
}

export interface GuardConfig {
  objective: string;
  tools: ToolDef[];
  limits?: Partial<Limits>;
}

export interface Limits {
  maxToolSteps: number;
  maxTokensPerCall: number;
  maxTokensPerRun: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxToolSteps: 6,
  maxTokensPerCall: 1024,
  maxTokensPerRun: 20_000,
};
