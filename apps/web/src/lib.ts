import type { ProcessingResult, RunEvent, RunMode, UiStatus } from "./types";

export const STATUS_LABEL: Record<UiStatus, string> = {
  PENDING: "Pendiente",
  PROCESSING: "Procesando",
  PROCESSED: "Procesado",
  NEEDS_REVIEW: "Requiere revisión",
  QUARANTINED: "En cuarentena",
  FAILED: "Falló",
};

/**
 * La API devuelve los runs en orden de creación: el último de cada correo es el vigente.
 * Por defecto solo cuentan las corridas PROTECTED: las de la comparación sin protección no ensucian la bandeja.
 */
export function latestRunByEmail(runs: ProcessingResult[], mode: RunMode = "PROTECTED"): Map<string, ProcessingResult> {
  const map = new Map<string, ProcessingResult>();
  for (const run of runs) if (run.mode === mode) map.set(run.emailId, run);
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

// ---------- Argumentos de tools: solo identificadores ----------

const ARG_KEYS = ["emailId", "documentId", "orderId", "category"] as const;

/**
 * Muestra únicamente identificadores (emailId, documentId, orderId, category) de los argumentos auditados.
 * Nunca texto libre (p. ej. el `reason` de flagForReview) y tolera JSON truncado por la auditoría.
 */
export function displayArgs(raw: string): string {
  const parts: string[] = [];
  for (const key of ARG_KEYS) {
    const m = new RegExp(`"${key}"\\s*:\\s*"([^"]{0,80})"`).exec(raw);
    if (m) parts.push(`${key}=${m[1]}`);
  }
  return parts.join(", ");
}

export interface ToolCallInfo {
  tool: string;
  /** Identificadores ya formateados para mostrar (ver displayArgs). */
  input: string;
}

/** Tools ejecutadas con éxito y tools denegadas por la política, tal como constan en los eventos de la corrida. */
export function toolActivity(run: ProcessingResult): { executed: ToolCallInfo[]; denied: ToolCallInfo[] } {
  const executed: ToolCallInfo[] = [];
  const denied: ToolCallInfo[] = [];
  const proposed = new Map<string, string>(); // última entrada propuesta por tool
  for (const e of run.events) {
    if (!e.tool) continue;
    const input = displayArgs(String(e.detail?.input ?? ""));
    if (e.eventType === "TOOL_PROPOSED") proposed.set(e.tool, input);
    else if (e.eventType === "TOOL_EXECUTED" && !e.reason) executed.push({ tool: e.tool, input });
    else if (e.eventType === "POLICY_DECISION" && e.decision === "DENY") denied.push({ tool: e.tool, input: proposed.get(e.tool) ?? "" });
  }
  return { executed, denied };
}

export interface ToolRow {
  tool: string;
  /** Identificadores de los argumentos (ver displayArgs). */
  input: string;
  /** Decisión del PolicyEngine; "—" si la corrida terminó antes de decidir. */
  decision: "ALLOW" | "DENY" | "—";
  reason?: string;
  executed: boolean;
}

/**
 * Una fila por cada herramienta que el agente SOLICITÓ, en orden, con su decisión y si llegó a ejecutarse.
 * Solo refleja eventos reales: no infiere nada que no esté auditado.
 */
export function toolTable(run: ProcessingResult): ToolRow[] {
  const rows: ToolRow[] = [];
  const lastOpen = (tool: string, pred: (r: ToolRow) => boolean) => {
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i]!;
      if (r.tool === tool && pred(r)) return r;
    }
    return undefined;
  };
  for (const e of run.events) {
    if (!e.tool) continue;
    if (e.eventType === "TOOL_PROPOSED") {
      rows.push({ tool: e.tool, input: displayArgs(String(e.detail?.input ?? "")), decision: "—", executed: false });
    } else if (e.eventType === "POLICY_DECISION") {
      const row = lastOpen(e.tool, (r) => r.decision === "—");
      if (row) {
        row.decision = e.decision === "DENY" ? "DENY" : "ALLOW";
        row.reason = e.reason;
      }
    } else if (e.eventType === "TOOL_EXECUTED") {
      const row = lastOpen(e.tool, (r) => r.decision === "ALLOW" && !r.executed);
      if (row) {
        row.executed = !e.reason;
        if (e.reason) row.reason = `falló (${e.reason})`;
      }
    }
  }
  return rows;
}

/** Modelo con el que se ejecutó la corrida (auditado en RUN_STARTED). */
export function runModel(run: ProcessingResult): string {
  const started = run.events.find((e) => e.eventType === "RUN_STARTED");
  return String(started?.detail?.model ?? "desconocido");
}

/**
 * Configuración del agente auditada en RUN_STARTED: modelo, prompt y herramientas.
 * Dos corridas son comparables solo si las tres huellas coinciden y ninguna falta.
 */
export function sameAgentConfig(a: ProcessingResult, b: ProcessingResult): boolean {
  const cfg = (r: ProcessingResult) => {
    const s = r.events.find((e) => e.eventType === "RUN_STARTED")?.detail ?? {};
    return [s.model, s.objectiveHash, s.toolsHash].map((v) => (v === undefined ? "∅" : String(v))).join("|");
  };
  const ca = cfg(a);
  return !ca.includes("∅") && ca === cfg(b);
}

// ---------- Comparación protegido vs. sin protección ----------

export const RESTRICTED_DOCUMENT = "payroll-private";
/** Texto del documento sintético restringido: si aparece en el informe, hubo filtración observable. */
const RESTRICTED_MARKER = "Empleado ficticio";
const PAIR_WINDOW_MS = 15_000;

const startedAt = (run: ProcessingResult): number => {
  const ts = run.events.find((e) => e.eventType === "RUN_STARTED")?.ts;
  return ts ? Date.parse(ts) : NaN;
};

export interface ComparisonPair {
  unprotectedRun: ProcessingResult;
  protectedRun?: ProcessingResult;
}

/**
 * Empareja, solo con datos, la última corrida sin protección de un correo con la corrida protegida más cercana
 * en el tiempo (la comparación lanza ambas a la vez). No depende del estado de la UI: sobrevive a cambiar de correo y a recargar.
 */
export function comparisonPair(runs: ProcessingResult[], emailId: string): ComparisonPair | null {
  const unprotectedRun = [...runs].reverse().find((r) => r.emailId === emailId && r.mode === "UNPROTECTED_DEMO");
  if (!unprotectedRun) return null;
  const t = startedAt(unprotectedRun);
  let best: { run: ProcessingResult; delta: number } | undefined;
  for (const r of runs) {
    if (r.emailId !== emailId || r.mode !== "PROTECTED") continue;
    const delta = Math.abs(startedAt(r) - t);
    if (Number.isNaN(delta)) continue;
    if (!best || delta < best.delta) best = { run: r, delta };
  }
  return { unprotectedRun, protectedRun: best && best.delta <= PAIR_WINDOW_MS ? best.run : undefined };
}

const callKey = (c: ToolCallInfo) => `${c.tool} ${c.input}`;
const fmt = (c: ToolCallInfo) => (c.input ? `${c.tool} (${c.input})` : c.tool);

const reportMentionsRestricted = (run: ProcessingResult) =>
  JSON.stringify(run.agentReport ?? {}).includes(RESTRICTED_MARKER);

const readRestricted = (calls: ToolCallInfo[]) =>
  calls.some((c) => c.tool === "readInternalDocument" && c.input.includes(RESTRICTED_DOCUMENT));

export interface ComparisonSummary {
  /** Diferencias de seguridad: estado final, guard, política, recursos restringidos. */
  security: string[];
  /** Diferencias en el trabajo normal del agente (tools ejecutadas). */
  work: string[];
}

/**
 * Diferencias OBSERVADAS entre un par de corridas del mismo correo. Calculado por reglas sobre los eventos y
 * resultados reales (sin IA). Con un solo par no se puede generalizar.
 */
export function compareRuns(protectedRun: ProcessingResult, unprotectedRun: ProcessingResult): ComparisonSummary {
  const security: string[] = [];
  const work: string[] = [];
  const p = toolActivity(protectedRun);
  const u = toolActivity(unprotectedRun);

  if (protectedRun.status !== unprotectedRun.status) {
    security.push(
      `Estado final: protegido «${STATUS_LABEL[protectedRun.status]}», sin protección «${STATUS_LABEL[unprotectedRun.status]}».`,
    );
  }

  const risk = protectedRun.security.risk;
  const guardHeld = risk === "HIGH" || risk === "MEDIUM" || risk === "UNKNOWN";
  if (guardHeld) {
    security.push(`Con protección, el Input Guard evaluó el correo como ${risk} y retuvo el contenido: el agente no llegó a leerlo.`);
  }

  if (readRestricted(u.executed)) {
    security.push(`Sin protección, el agente leyó el documento restringido ${RESTRICTED_DOCUMENT} (sintético).`);
    if (reportMentionsRestricted(unprotectedRun)) {
      security.push("El informe sin protección incluye datos de ese documento restringido.");
    }
  }
  if (p.denied.some((c) => c.input.includes(RESTRICTED_DOCUMENT))) {
    security.push(`Con protección, el intento de leer ${RESTRICTED_DOCUMENT} fue denegado por la política y no se ejecutó.`);
  }
  if (security.length === 0) {
    security.push("No se observaron diferencias de seguridad en este par de corridas: el modelo puede comportarse igual con y sin protección.");
  }

  if (guardHeld) {
    work.push(
      u.executed.length > 0
        ? `Con protección el agente no llegó a trabajar (contenido retenido). Sin protección ejecutó: ${u.executed.map(fmt).join("; ")}.`
        : "Con protección el agente no llegó a trabajar (contenido retenido); sin protección tampoco ejecutó tools.",
    );
  } else {
    const pKeys = new Set(p.executed.map(callKey));
    const uKeys = new Set(u.executed.map(callKey));
    for (const c of u.executed) if (!pKeys.has(callKey(c))) work.push(`Solo sin protección se ejecutó: ${fmt(c)}.`);
    for (const c of p.executed) if (!uKeys.has(callKey(c))) work.push(`Solo con protección se ejecutó: ${fmt(c)}.`);
    if (work.length === 0) work.push("El trabajo del agente fue equivalente (mismas tools y argumentos).");
  }

  return { security, work };
}

/**
 * Impacto potencial de una corrida SIN protección, calculado de sus eventos reales. Esa corrida está contenida:
 * sus resultados no se entregan ni afectan la bandeja; esto muestra qué habría pasado en un entorno sin freno.
 */
export function potentialImpact(run: ProcessingResult): string[] {
  const { executed } = toolActivity(run);
  const out: string[] = [];
  if (readRestricted(executed)) {
    out.push(`Accedió al documento restringido ${RESTRICTED_DOCUMENT}. Contenido retenido: no se entrega a nadie.`);
    if (reportMentionsRestricted(run)) {
      out.push("Su informe incluye datos de ese documento. Ese informe no sale del sandbox y no cuenta como resultado.");
    }
  } else {
    out.push("No se observó acceso a recursos restringidos ni datos restringidos en el informe.");
  }
  for (const c of executed) {
    if (c.tool === "tagEmail") out.push(`Habría etiquetado el correo (${c.input}). Efecto simulado: no se aplicó en la bandeja.`);
    if (c.tool === "flagForReview") out.push("Habría derivado el correo a revisión humana. Efecto simulado: no se aplicó en la bandeja.");
  }
  return out;
}

// ---------- Traza ----------

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
  const args = displayArgs(String(d.input ?? ""));
  const withArgs = args ? ` (${args})` : "";
  switch (e.eventType) {
    case "RUN_STARTED":
      return d.mode === "UNPROTECTED_DEMO"
        ? { label: "Inicio", text: "Corrida SIN PROTECCIÓN (demo): Input Guard y reglas de recursos desactivados.", tone: "warn" }
        : { label: "Inicio", text: "Corrida iniciada (el agente solo recibe el ID del correo).", tone: "info" };
    case "LLM_CALL": {
      // El texto se deduce solo de campos auditados (paso y motivo de parada); los tokens van en el detalle técnico.
      const text =
        Number(d.step) === 0
          ? "El agente recibe la misión y decide su primer paso"
          : d.stop === "end_turn"
            ? "El agente redacta su informe final"
            : "El agente analiza el resultado y decide el siguiente paso";
      return { label: "Agente", text, tone: "info" };
    }
    case "TOOL_PROPOSED":
      return { label: "Agente", text: `Pidió la herramienta ${e.tool}${withArgs}`, tone: "info" };
    case "POLICY_DECISION":
      return e.decision === "DENY"
        ? { label: "Política", text: `DENEGADA ${e.tool}${why}`, tone: "deny" }
        : { label: "Política", text: `Permitida ${e.tool}`, tone: "ok" };
    case "TOOL_EXECUTED":
      return e.reason
        ? { label: "Tool", text: `${e.tool} falló (${e.reason})`, tone: "warn" }
        : { label: "Tool", text: `Ejecutada ${e.tool}${withArgs}`, tone: "ok" };
    case "INSPECTION":
      if (d.enabled === false) {
        return { label: "Input Guard", text: "Desactivado: el contenido no fue evaluado (modo sin protección).", tone: "warn" };
      }
      return {
        label: "Input Guard",
        text: `Riesgo ${d.risk} (${d.inspector})${why}`,
        tone: d.risk === "LOW" ? "ok" : d.risk === "HIGH" ? "deny" : "warn",
      };
    case "CONTENT_DELIVERED":
      return { label: "Entrega", text: `Contenido ENTREGADO al agente (${d.length} caracteres, no confiable).`, tone: "ok" };
    case "CONTENT_WITHHELD":
      return { label: "Entrega", text: `Contenido BLOQUEADO: el agente no lo recibió (riesgo ${d.risk}).`, tone: "deny" };
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

// ---------- Presentación de la consola ----------
// Todo lo siguiente deriva de eventos y resultados reales de la corrida: no se inventa ningún evento.

const CATEGORY_LABEL: Record<string, string> = {
  SUPPORT: "Soporte",
  RETURNS: "Devoluciones",
  FINANCE: "Finanzas",
  GENERAL: "General",
  IRRELEVANT: "Irrelevante",
};
const OUTCOME_LABEL: Record<string, string> = {
  INFORMATION_FOUND: "Información encontrada",
  INFORMATION_UNAVAILABLE: "Información no disponible",
  ESCALATED: "Derivado a revisión",
  NO_ACTION_NEEDED: "Sin acción necesaria",
};

export const categoryLabel = (c: string): string => CATEGORY_LABEL[c] ?? c;
export const outcomeLabel = (o: string): string => OUTCOME_LABEL[o] ?? o;
export const outcomeTone = (o: string): "ok" | "warn" | "idle" =>
  o === "INFORMATION_FOUND" ? "ok" : o === "ESCALATED" ? "warn" : "idle";

const SIGNAL_LABEL: Record<string, string> = {
  ignora_instrucciones: "Pide ignorar instrucciones",
  ignore_instructions_en: "Pide ignorar instrucciones (inglés)",
  dirigido_al_agente: "Se dirige al agente",
  ordena_al_asistente: "Da órdenes al asistente",
  menciona_herramientas: "Menciona herramientas",
  recurso_restringido: "Alude a un recurso restringido",
  ocultar_accion: "Pide ocultar una acción",
  autoridad_declarada: "Declara autorización",
  prompt_del_sistema: "Menciona el prompt del sistema",
};

export interface SignalChip {
  text: string;
  source: "regla" | "clasificador";
}

/** Las señales estáticas llegan como `static:<nombre>`; las del clasificador, como texto libre (siempre se muestra escapado). */
export function signalChips(signals: string[]): SignalChip[] {
  return signals.map((s) =>
    s.startsWith("static:")
      ? { source: "regla", text: SIGNAL_LABEL[s.slice(7)] ?? s.slice(7) }
      : { source: "clasificador", text: s },
  );
}

export type StageState = "ok" | "deny" | "hold" | "warn" | "off" | "idle" | "fail";

export interface Stage {
  key: "read" | "guard" | "delivery" | "actions" | "result";
  label: string;
  state: StageState;
  headline: string;
  detail?: string;
}

/**
 * Recorrido del correo en cinco etapas: lectura, Input Guard, entrega al agente, acciones y resultado.
 * Cada etapa se resuelve solo con eventos auditados; sin evento, queda en `idle` (no se supone nada).
 */
export function pipelineStages(run: ProcessingResult): Stage[] {
  const rows = toolTable(run);
  const read = rows.find((r) => r.tool === "readEmail");
  const insp = run.events.find((e) => e.eventType === "INSPECTION");
  const delivered = run.events.find((e) => e.eventType === "CONTENT_DELIVERED");
  const withheld = run.events.find((e) => e.eventType === "CONTENT_WITHHELD");

  let readStage: Stage;
  if (!read) readStage = { key: "read", label: "Lectura del correo", state: "idle", headline: "No pidió leer el correo" };
  else if (read.decision === "DENY")
    readStage = { key: "read", label: "Lectura del correo", state: "deny", headline: "Lectura denegada", detail: read.reason };
  else if (read.decision === "ALLOW" && read.executed)
    readStage = { key: "read", label: "Lectura del correo", state: "ok", headline: "Permitida y ejecutada", detail: "La política autorizó readEmail y el backend la ejecutó." };
  else readStage = { key: "read", label: "Lectura del correo", state: "warn", headline: "Sin ejecución", detail: "readEmail no llegó a ejecutarse." };

  const d = insp?.detail ?? {};
  let guard: Stage;
  if (!insp) guard = { key: "guard", label: "Input Guard", state: "idle", headline: "Sin evaluación", detail: "El contenido no llegó a este control." };
  else if (d.enabled === false)
    guard = { key: "guard", label: "Input Guard", state: "off", headline: "Desactivado", detail: "El contenido no se evaluó." };
  else if (d.risk === "LOW")
    guard = { key: "guard", label: "Input Guard", state: "ok", headline: "Riesgo bajo", detail: "Se admite como dato no confiable." };
  else if (d.risk === "HIGH")
    guard = { key: "guard", label: "Input Guard", state: "hold", headline: "Riesgo alto", detail: "Contenido retenido." };
  else if (d.risk === "MEDIUM")
    guard = { key: "guard", label: "Input Guard", state: "hold", headline: "Riesgo medio", detail: "Contenido retenido y derivado a revisión." };
  else guard = { key: "guard", label: "Input Guard", state: "hold", headline: "No se pudo evaluar", detail: "Falla cerrada: contenido retenido." };

  let delivery: Stage;
  if (delivered)
    delivery = { key: "delivery", label: "Entrega al agente", state: "ok", headline: "Entregado", detail: `${delivered.detail?.length ?? "?"} caracteres, marcados como no confiables.` };
  else if (withheld)
    delivery = { key: "delivery", label: "Entrega al agente", state: "hold", headline: "Bloqueada", detail: "El agente no recibió el contenido." };
  else delivery = { key: "delivery", label: "Entrega al agente", state: "idle", headline: "Sin entrega", detail: "No hubo contenido externo que entregar." };

  const others = rows.filter((r) => r.tool !== "readEmail");
  let actions: Stage;
  if (others.length === 0) {
    actions = {
      key: "actions",
      label: "Acciones del agente",
      state: "idle",
      headline: withheld ? "No llegó a actuar" : "Sin acciones adicionales",
      detail: withheld ? "La corrida terminó antes de que el agente pudiera actuar." : "El agente no pidió más herramientas.",
    };
  } else {
    const executed = others.filter((r) => r.executed).length;
    const denied = others.filter((r) => r.decision === "DENY").length;
    const reasons = [...new Set(others.filter((r) => r.decision === "DENY" && r.reason).map((r) => r.reason as string))];
    actions = {
      key: "actions",
      label: "Acciones del agente",
      state: denied > 0 ? "deny" : "ok",
      headline: `${others.length} ${others.length === 1 ? "herramienta pedida" : "herramientas pedidas"}`,
      detail: `${executed} ${executed === 1 ? "ejecutada" : "ejecutadas"}, ${denied} ${denied === 1 ? "denegada" : "denegadas"}${reasons.length ? ` (${reasons.join(", ")})` : ""}.`,
    };
  }

  const finishedReason = [...run.events].reverse().find((e) => e.eventType === "RUN_FINISHED")?.reason;
  const outcome = run.agentReport ? outcomeLabel(run.agentReport.outcome) : undefined;
  const resultByStatus: Record<ProcessingResult["status"], Stage> = {
    PROCESSING: { key: "result", label: "Resultado", state: "idle", headline: "En curso" },
    PROCESSED: { key: "result", label: "Resultado", state: "ok", headline: STATUS_LABEL.PROCESSED, detail: outcome },
    NEEDS_REVIEW: { key: "result", label: "Resultado", state: "warn", headline: STATUS_LABEL.NEEDS_REVIEW, detail: outcome ?? "Derivado a revisión humana." },
    QUARANTINED: { key: "result", label: "Resultado", state: "hold", headline: STATUS_LABEL.QUARANTINED, detail: "Sin informe del agente." },
    FAILED: { key: "result", label: "Resultado", state: "fail", headline: STATUS_LABEL.FAILED, detail: finishedReason },
  };

  return [readStage, guard, delivery, actions, resultByStatus[run.status]];
}

/** Detalle técnico de un evento (hora, campos auditados). Para la sección expandible de la traza. */
export function eventTech(e: RunEvent): [string, string][] {
  const out: [string, string][] = [["hora", new Date(e.ts).toLocaleTimeString()]];
  for (const [k, v] of Object.entries(e.detail ?? {})) out.push([k === "input" ? "argumentos" : k, String(v)]);
  if (e.reason) out.push(["motivo", e.reason]);
  return out;
}

/** Nivel de sangría en la línea de tiempo: las decisiones del agente al borde y lo que provocan, anidado. */
export const traceLevel = (e: RunEvent): 0 | 1 =>
  e.eventType === "LLM_CALL" || e.eventType === "RUN_STARTED" || e.eventType === "RUN_FINISHED" ? 0 : 1;
