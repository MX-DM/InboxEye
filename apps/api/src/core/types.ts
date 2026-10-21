import type { z } from "zod";

export type RunStatus =
  | "PROCESSING"
  | "PROCESSED"
  | "QUARANTINED"
  | "BLOCKED_ACTION"
  | "FAILED";

export type EventType =
  | "RUN_STARTED"
  | "LLM_CALL"
  | "TOOL_PROPOSED"
  | "POLICY_DECISION"
  | "TOOL_EXECUTED"
  | "INSPECTION"
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

export interface Run {
  id: string;
  emailId: string;
  status: RunStatus;
  summary?: string;
  tokens: { input: number; output: number };
  events: RunEvent[];
}

export interface RunContext {
  runId: string;
  emailId: string;
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
