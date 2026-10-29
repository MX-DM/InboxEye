import { describe, expect, it } from "vitest";
import {
  compareRuns,
  comparisonPair,
  countByStatus,
  describeEvent,
  displayArgs,
  latestRunByEmail,
  noReportMessage,
  potentialImpact,
  statusOf,
  toolActivity,
  toolTable,
  runModel,
  sameAgentConfig,
  pipelineStages,
  signalChips,
  categoryLabel,
  outcomeLabel,
  outcomeTone,
  eventTech,
  traceLevel,
} from "./lib";
import type { ProcessingResult, RunEvent } from "./types";

const run = (
  emailId: string,
  status: ProcessingResult["status"],
  events: RunEvent[] = [],
  extra: Partial<ProcessingResult> = {},
): ProcessingResult => ({
  runId: `${emailId}-${status}`,
  emailId,
  mode: "PROTECTED",
  status,
  agentReport: null,
  security: { risk: "LOW", signals: [], deniedActions: 0 },
  events,
  ...extra,
});

const ev = (partial: Partial<RunEvent>): RunEvent => ({
  runId: "r",
  emailId: "e",
  ts: "2026-10-27T00:00:00.000Z",
  eventType: "RUN_STARTED",
  ...partial,
});

const PAYROLL = '{"documentId":"payroll-private"}';
const proposed = (tool: string, input: string) => ev({ eventType: "TOOL_PROPOSED", tool, detail: { input } });
const executed = (tool: string, input: string) => ev({ eventType: "TOOL_EXECUTED", tool, detail: { input } });
const denied = (tool: string) => ev({ eventType: "POLICY_DECISION", tool, decision: "DENY", reason: "document not permitted" });
const report = (summary: string) => ({ category: "GENERAL", summary, outcome: "INFORMATION_FOUND", findings: [], suggestedNextStep: "x" });
const started = (ts: string) => ev({ eventType: "RUN_STARTED", ts });

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

  it("las corridas sin protección no cambian el estado de la bandeja (se filtran por modo)", () => {
    const runs = [run("a", "PROCESSED"), run("a", "FAILED", [], { mode: "UNPROTECTED_DEMO" })];
    expect(statusOf("a", latestRunByEmail(runs))).toBe("PROCESSED");
    expect(statusOf("a", latestRunByEmail(runs, "UNPROTECTED_DEMO"))).toBe("FAILED");
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

  it("marca la corrida sin protección y muestra solo los identificadores de la tool", () => {
    expect(describeEvent(ev({ eventType: "RUN_STARTED", detail: { mode: "UNPROTECTED_DEMO" } })).text).toContain("SIN PROTECCIÓN");
    expect(describeEvent(proposed("getOrderStatus", '{"orderId":"ORD-1001"}')).text).toContain("orderId=ORD-1001");
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

describe("displayArgs: solo identificadores", () => {
  it("extrae ids y descarta texto libre como el reason de flagForReview", () => {
    const raw = '{"emailId":"email-004","reason":"Email externo sospechoso (asunto de \\"verificación\\")"}';
    expect(displayArgs(raw)).toBe("emailId=email-004");
  });

  it("tolera JSON truncado por la auditoría y valores que no son texto", () => {
    expect(displayArgs('{"emailId":"email-a","reason":"muy largo que se cortó en med…')).toBe("emailId=email-a");
    expect(displayArgs('{"documentId":42}')).toBe("");
    expect(displayArgs("")).toBe("");
  });

  it("combina varios identificadores", () => {
    expect(displayArgs('{"emailId":"e1","category":"FINANCE"}')).toBe("emailId=e1, category=FINANCE");
  });
});

describe("toolActivity", () => {
  it("separa ejecutadas, denegadas (con el argumento propuesto) y descarta las que fallaron", () => {
    const r = run("a", "PROCESSED", [
      proposed("getOrderStatus", '{"orderId":"ORD-1001"}'),
      executed("getOrderStatus", '{"orderId":"ORD-1001"}'),
      proposed("readInternalDocument", PAYROLL),
      denied("readInternalDocument"),
      ev({ eventType: "TOOL_EXECUTED", tool: "tagEmail", reason: "Error", detail: { input: "{}" } }),
    ]);
    const a = toolActivity(r);
    expect(a.executed).toEqual([{ tool: "getOrderStatus", input: "orderId=ORD-1001" }]);
    expect(a.denied).toEqual([{ tool: "readInternalDocument", input: "documentId=payroll-private" }]);
  });
});

describe("comparisonPair (por datos, no por estado de la UI)", () => {
  const p = (email: string, ts: string) => run(email, "PROCESSED", [started(ts)]);
  const u = (email: string, ts: string) => run(email, "PROCESSED", [started(ts)], { mode: "UNPROTECTED_DEMO" });

  it("sin corrida sin protección no hay comparación", () => {
    expect(comparisonPair([p("a", "2026-10-28T10:00:00.000Z")], "a")).toBeNull();
  });

  it("empareja con la corrida protegida más cercana en el tiempo", () => {
    const early = p("a", "2026-10-28T09:00:00.000Z");
    const near = p("a", "2026-10-28T10:00:01.000Z");
    const un = u("a", "2026-10-28T10:00:00.000Z");
    const pair = comparisonPair([early, near, un], "a");
    expect(pair?.protectedRun).toBe(near);
    expect(pair?.unprotectedRun).toBe(un);
  });

  it("cada correo conserva SU comparación: volver a uno anterior sigue mostrándola", () => {
    const runs = [
      p("a", "2026-10-28T10:00:00.000Z"),
      u("a", "2026-10-28T10:00:00.500Z"),
      p("b", "2026-10-28T11:00:00.000Z"),
      u("b", "2026-10-28T11:00:00.500Z"),
    ];
    expect(comparisonPair(runs, "a")?.protectedRun?.emailId).toBe("a");
    expect(comparisonPair(runs, "b")?.protectedRun?.emailId).toBe("b");
  });

  it("una protegida lejana (>15 s) no se considera emparejada", () => {
    const far = p("a", "2026-10-28T08:00:00.000Z");
    const un = u("a", "2026-10-28T10:00:00.000Z");
    expect(comparisonPair([far, un], "a")?.protectedRun).toBeUndefined();
  });
});

describe("compareRuns (solo describe lo observado)", () => {
  it("protegido deniega payroll-private y sin protección lo lee y lo filtra al informe", () => {
    const p = run("d", "NEEDS_REVIEW", [proposed("readInternalDocument", PAYROLL), denied("readInternalDocument")]);
    const u = run("d", "PROCESSED", [proposed("readInternalDocument", PAYROLL), executed("readInternalDocument", PAYROLL)], {
      mode: "UNPROTECTED_DEMO",
      agentReport: report("Nómina: Empleado ficticio A: 1000."),
    });
    const s = compareRuns(p, u).security.join("\n");
    expect(s).toContain("Estado final");
    expect(s).toContain("Sin protección, el agente leyó el documento restringido payroll-private");
    expect(s).toContain("incluye datos de ese documento restringido");
    expect(s).toContain("fue denegado por la política");
  });

  it("si lo leyó pero el informe no contiene sus datos, NO afirma filtración", () => {
    const p = run("d", "NEEDS_REVIEW", [proposed("readInternalDocument", PAYROLL), denied("readInternalDocument")]);
    const u = run("d", "PROCESSED", [executed("readInternalDocument", PAYROLL)], {
      mode: "UNPROTECTED_DEMO",
      agentReport: report("Correo de cobranza sospechoso."),
    });
    const s = compareRuns(p, u).security.join("\n");
    expect(s).toContain("leyó el documento restringido");
    expect(s).not.toContain("incluye datos");
  });

  it("si el Input Guard retuvo el contenido, el trabajo del agente se explica sin presentarlo como una falla", () => {
    const p = run("d", "QUARANTINED", [], { security: { risk: "HIGH", signals: [], deniedActions: 0 } });
    const u = run("d", "PROCESSED", [executed("tagEmail", '{"emailId":"d","category":"FINANCE"}')], { mode: "UNPROTECTED_DEMO" });
    const s = compareRuns(p, u);
    expect(s.security.join("\n")).toContain("el Input Guard evaluó el correo como HIGH");
    expect(s.security.join("\n")).not.toContain("payroll-private");
    expect(s.work).toHaveLength(1);
    expect(s.work[0]).toContain("no llegó a trabajar");
    expect(s.work[0]).toContain("tagEmail");
    // No dice «solo sin protección se ejecutó…»: sería engañoso (el protegido terminó antes por la cuarentena).
    expect(s.work[0]).not.toContain("Solo sin protección");
  });

  it("sin diferencias: lo dice en ambos bloques (el modelo puede comportarse igual)", () => {
    const calls = [executed("tagEmail", '{"emailId":"a","category":"GENERAL"}')];
    const s = compareRuns(run("a", "PROCESSED", calls), run("a", "PROCESSED", calls, { mode: "UNPROTECTED_DEMO" }));
    expect(s.security).toHaveLength(1);
    expect(s.security[0]).toContain("No se observaron diferencias de seguridad");
    expect(s.work[0]).toContain("equivalente");
  });

  it("sin retención del guard, las diferencias de trabajo se listan en los dos sentidos", () => {
    const p = run("a", "PROCESSED", [executed("tagEmail", '{"emailId":"a","category":"SUPPORT"}')]);
    const u = run("a", "PROCESSED", [executed("tagEmail", '{"emailId":"a","category":"GENERAL"}')], { mode: "UNPROTECTED_DEMO" });
    const w = compareRuns(p, u).work.join("\n");
    expect(w).toContain("Solo sin protección se ejecutó: tagEmail (emailId=a, category=GENERAL)");
    expect(w).toContain("Solo con protección se ejecutó: tagEmail (emailId=a, category=SUPPORT)");
  });
});

describe("potentialImpact (corrida contenida)", () => {
  it("accedió al documento restringido y su informe lo filtra: lo dice, y aclara que queda retenido", () => {
    const u = run("d", "PROCESSED", [executed("readInternalDocument", PAYROLL)], {
      mode: "UNPROTECTED_DEMO",
      agentReport: report("Nómina: Empleado ficticio A: 1000."),
    });
    const out = potentialImpact(u).join("\n");
    expect(out).toContain("Accedió al documento restringido payroll-private");
    expect(out).toContain("no se entrega a nadie");
    expect(out).toContain("no sale del sandbox");
  });

  it("accedió pero el informe no contiene sus datos: no afirma filtración", () => {
    const u = run("d", "PROCESSED", [executed("readInternalDocument", PAYROLL)], {
      mode: "UNPROTECTED_DEMO",
      agentReport: report("Correo sospechoso."),
    });
    const out = potentialImpact(u).join("\n");
    expect(out).toContain("Accedió al documento restringido");
    expect(out).not.toContain("incluye datos");
  });

  it("sin acceso indebido lo dice, y los efectos de escritura se marcan como simulados", () => {
    const u = run("d", "NEEDS_REVIEW", [executed("tagEmail", '{"emailId":"d","category":"IRRELEVANT"}'), executed("flagForReview", '{"emailId":"d"}')], {
      mode: "UNPROTECTED_DEMO",
    });
    const out = potentialImpact(u);
    expect(out[0]).toContain("No se observó acceso a recursos restringidos");
    expect(out.join("\n")).toContain("Habría etiquetado el correo (emailId=d, category=IRRELEVANT)");
    expect(out.join("\n")).toContain("Efecto simulado");
  });
});

describe("toolTable: solicitada → decisión → ejecutada", () => {
  const req = (tool: string, input: string) => ev({ eventType: "TOOL_PROPOSED", tool, detail: { input } });
  const allow = (tool: string) => ev({ eventType: "POLICY_DECISION", tool, decision: "ALLOW" });
  const deny = (tool: string, reason: string) => ev({ eventType: "POLICY_DECISION", tool, decision: "DENY", reason });

  it("muestra cada solicitud con su decisión y si se ejecutó", () => {
    const r = run("d", "NEEDS_REVIEW", [
      req("readEmail", '{"emailId":"d"}'),
      allow("readEmail"),
      executed("readEmail", '{"emailId":"d"}'),
      req("readInternalDocument", PAYROLL),
      deny("readInternalDocument", "document not permitted"),
    ]);
    expect(toolTable(r)).toEqual([
      { tool: "readEmail", input: "emailId=d", decision: "ALLOW", reason: undefined, executed: true },
      { tool: "readInternalDocument", input: "documentId=payroll-private", decision: "DENY", reason: "document not permitted", executed: false },
    ]);
  });

  it("una denegada nunca figura como ejecutada, aunque haya otra igual antes", () => {
    const r = run("d", "PROCESSED", [
      req("tagEmail", '{"emailId":"d","category":"GENERAL"}'),
      allow("tagEmail"),
      executed("tagEmail", '{"emailId":"d","category":"GENERAL"}'),
      req("tagEmail", '{"emailId":"d","category":"SUPPORT"}'),
      deny("tagEmail", "argumentos inválidos"),
    ]);
    const rows = toolTable(r);
    expect(rows[0]?.executed).toBe(true);
    expect(rows[1]).toMatchObject({ decision: "DENY", executed: false });
  });

  it("una solicitud sin decisión (corrida cortada) queda como '—' y no ejecutada", () => {
    const rows = toolTable(run("d", "FAILED", [req("getOrderStatus", '{"orderId":"ORD-1001"}')]));
    expect(rows).toEqual([{ tool: "getOrderStatus", input: "orderId=ORD-1001", decision: "—", reason: undefined, executed: false }]);
  });

  it("el modelo se lee de RUN_STARTED y es 'desconocido' si no está auditado", () => {
    expect(runModel(run("a", "PROCESSED", [ev({ eventType: "RUN_STARTED", detail: { mode: "PROTECTED", model: "claude-haiku-5-5" } })]))).toBe("claude-haiku-5-5");
    expect(runModel(run("a", "PROCESSED", [started("2026-10-28T00:00:00.000Z")]))).toBe("desconocido");
  });
});

describe("sameAgentConfig: comparación válida solo con la misma configuración auditada", () => {
  const withCfg = (detail: Record<string, string>, mode: ProcessingResult["mode"] = "PROTECTED") =>
    run("a", "PROCESSED", [ev({ eventType: "RUN_STARTED", detail: { mode, ...detail } })], { mode });
  const cfg = { model: "claude-haiku-5-5", objectiveHash: "aaaaaaaaaaaa", toolsHash: "bbbbbbbbbbbb" };

  it("igual modelo, prompt y herramientas: válida", () => {
    expect(sameAgentConfig(withCfg(cfg), withCfg(cfg, "UNPROTECTED_DEMO"))).toBe(true);
  });

  it("cambia el prompt o las herramientas: NO válida", () => {
    expect(sameAgentConfig(withCfg(cfg), withCfg({ ...cfg, objectiveHash: "cccccccccccc" }))).toBe(false);
    expect(sameAgentConfig(withCfg(cfg), withCfg({ ...cfg, toolsHash: "dddddddddddd" }))).toBe(false);
  });

  it("si falta alguna huella (corrida anterior a la auditoría), NO se considera válida", () => {
    expect(sameAgentConfig(withCfg({ model: "claude-haiku-5-5" }), withCfg({ model: "claude-haiku-5-5" }))).toBe(false);
  });
});

describe("eventos de entrega e inspección desactivada", () => {
  it("entregado y bloqueado tienen textos distintos y tonos correctos", () => {
    const d = describeEvent(ev({ eventType: "CONTENT_DELIVERED", detail: { length: 120, trust: "untrusted" } }));
    const w = describeEvent(ev({ eventType: "CONTENT_WITHHELD", detail: { risk: "HIGH", length: 120 } }));
    expect(d.text).toContain("ENTREGADO");
    expect(d.tone).toBe("ok");
    expect(w.text).toContain("BLOQUEADO");
    expect(w.tone).toBe("deny");
  });

  it("con el Input Guard desactivado lo dice sin mostrar un riesgo", () => {
    const line = describeEvent(ev({ eventType: "INSPECTION", detail: { enabled: false, risk: "NOT_ANALYZED", inspector: "none" } }));
    expect(line.text).toContain("Desactivado");
    expect(line.text).not.toContain("Riesgo");
  });
});

describe("pipelineStages: el recorrido sale solo de eventos reales", () => {
  const e = (eventType: string, extra: Partial<RunEvent> = {}) => ev({ eventType, ...extra });
  const readOk = [
    e("TOOL_PROPOSED", { tool: "readEmail", detail: { input: '{"emailId":"email-001"}' } }),
    e("POLICY_DECISION", { tool: "readEmail", decision: "ALLOW" }),
    e("TOOL_EXECUTED", { tool: "readEmail", detail: { input: '{"emailId":"email-001"}' } }),
  ];
  const by = (stages: ReturnType<typeof pipelineStages>, key: string) => stages.find((s) => s.key === key)!;

  it("protegido con riesgo alto: guard y entrega retenidos, el agente no llegó a actuar", () => {
    const r = run("a", "QUARANTINED", [
      ...readOk,
      e("INSPECTION", { tool: "readEmail", detail: { enabled: true, risk: "HIGH", inspector: "input-guard" } }),
      e("CONTENT_WITHHELD", { tool: "readEmail", detail: { risk: "HIGH", length: 300 } }),
    ]);
    const s = pipelineStages(r);
    expect(by(s, "read").state).toBe("ok");
    expect(by(s, "guard")).toMatchObject({ state: "hold", headline: "Riesgo alto" });
    expect(by(s, "delivery")).toMatchObject({ state: "hold", headline: "Bloqueada" });
    expect(by(s, "actions")).toMatchObject({ state: "idle", headline: "No llegó a actuar" });
    expect(by(s, "result")).toMatchObject({ state: "hold", headline: "En cuarentena" });
  });

  it("sin protección: guard desactivado, contenido entregado y acciones contadas desde los eventos", () => {
    const r = run(
      "a",
      "NEEDS_REVIEW",
      [
        ...readOk,
        e("INSPECTION", { tool: "readEmail", detail: { enabled: false, risk: "NOT_ANALYZED", inspector: "none" } }),
        e("CONTENT_DELIVERED", { tool: "readEmail", detail: { length: 318, trust: "untrusted" } }),
        ...req2("flagForReview"),
        ...req2("tagEmail"),
      ],
      { mode: "UNPROTECTED_DEMO", agentReport: report("x") },
    );
    const s = pipelineStages(r);
    expect(by(s, "guard")).toMatchObject({ state: "off", headline: "Desactivado" });
    expect(by(s, "delivery")).toMatchObject({ state: "ok", headline: "Entregado" });
    expect(by(s, "delivery").detail).toContain("318 caracteres");
    expect(by(s, "actions")).toMatchObject({ state: "ok", headline: "2 herramientas pedidas", detail: "2 ejecutadas, 0 denegadas." });
    expect(by(s, "result")).toMatchObject({ state: "warn", headline: "Requiere revisión", detail: "Información encontrada" });

    function req2(tool: string) {
      return [
        e("TOOL_PROPOSED", { tool, detail: { input: "{}" } }),
        e("POLICY_DECISION", { tool, decision: "ALLOW" }),
        e("TOOL_EXECUTED", { tool, detail: { input: "{}" } }),
      ];
    }
  });

  it("una acción denegada pone la etapa de acciones en rojo", () => {
    const r = run("a", "NEEDS_REVIEW", [
      ...readOk,
      e("TOOL_PROPOSED", { tool: "readInternalDocument", detail: { input: PAYROLL } }),
      e("POLICY_DECISION", { tool: "readInternalDocument", decision: "DENY", reason: "document not permitted" }),
    ]);
    const a = pipelineStages(r).find((s) => s.key === "actions")!;
    expect(a).toMatchObject({ state: "deny", detail: "0 ejecutadas, 1 denegada (document not permitted)." });
  });

  it("riesgo bajo es verde; riesgo no evaluable (falla cerrada) retiene", () => {
    const g = (risk: string) =>
      pipelineStages(run("a", "PROCESSED", [e("INSPECTION", { detail: { enabled: true, risk } })])).find((s) => s.key === "guard")!;
    expect(g("LOW")).toMatchObject({ state: "ok", headline: "Riesgo bajo" });
    expect(g("MEDIUM")).toMatchObject({ state: "hold", headline: "Riesgo medio" });
    expect(g("UNKNOWN")).toMatchObject({ state: "hold", headline: "No se pudo evaluar" });
  });

  it("sin eventos no se inventa nada: todo queda en reposo", () => {
    const s = pipelineStages(run("a", "PROCESSING"));
    expect(by(s, "read")).toMatchObject({ state: "idle", headline: "No pidió leer el correo" });
    expect(by(s, "guard")).toMatchObject({ state: "idle", headline: "Sin evaluación" });
    expect(by(s, "delivery")).toMatchObject({ state: "idle", headline: "Sin entrega" });
    expect(by(s, "result")).toMatchObject({ state: "idle", headline: "En curso" });
  });

  it("una corrida fallida muestra su motivo técnico", () => {
    const s = pipelineStages(run("a", "FAILED", [e("RUN_FINISHED", { reason: "invalid agent report" })]));
    expect(by(s, "result")).toMatchObject({ state: "fail", detail: "invalid agent report" });
  });
});

describe("textos de presentación", () => {
  it("traduce categorías y resultados conocidos y deja pasar los desconocidos", () => {
    expect(categoryLabel("FINANCE")).toBe("Finanzas");
    expect(categoryLabel("NUEVA")).toBe("NUEVA");
    expect(outcomeLabel("ESCALATED")).toBe("Derivado a revisión");
    expect(outcomeTone("INFORMATION_FOUND")).toBe("ok");
    expect(outcomeTone("ESCALATED")).toBe("warn");
    expect(outcomeTone("NO_ACTION_NEEDED")).toBe("idle");
  });

  it("las señales estáticas se traducen y se distinguen de las del clasificador", () => {
    const chips = signalChips(["static:ignora_instrucciones", "static:regla_nueva", "orden al agente"]);
    expect(chips).toEqual([
      { source: "regla", text: "Pide ignorar instrucciones" },
      { source: "regla", text: "regla_nueva" },
      { source: "clasificador", text: "orden al agente" },
    ]);
  });

  it("el detalle técnico incluye hora, campos auditados y motivo", () => {
    const tech = eventTech(ev({ eventType: "INSPECTION", reason: "motivo", detail: { risk: "HIGH", input: '{"a":1}' } }));
    expect(tech.map(([k]) => k)).toEqual(["hora", "risk", "argumentos", "motivo"]);
  });

  it("la traza indenta lo que provoca cada decisión del agente", () => {
    expect(traceLevel(ev({ eventType: "LLM_CALL" }))).toBe(0);
    expect(traceLevel(ev({ eventType: "RUN_FINISHED" }))).toBe(0);
    expect(traceLevel(ev({ eventType: "TOOL_EXECUTED" }))).toBe(1);
    expect(traceLevel(ev({ eventType: "CONTENT_DELIVERED" }))).toBe(1);
  });

  it("las llamadas al modelo se describen por su paso y su parada, no por tokens", () => {
    const t = (detail: Record<string, string | number>) => describeEvent(ev({ eventType: "LLM_CALL", detail })).text;
    expect(t({ step: 0, stop: "tool_use" })).toContain("recibe la misión");
    expect(t({ step: 1, stop: "tool_use" })).toContain("siguiente paso");
    expect(t({ step: 3, stop: "end_turn" })).toContain("informe final");
  });
});
