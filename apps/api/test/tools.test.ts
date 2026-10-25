import { describe, expect, it, vi } from "vitest";
import { companyConfig } from "../src/company/config.js";
import { createGuardedAgent } from "../src/core/AgentRunner.js";
import { StubInspector } from "../src/core/inspector.js";
import type { LLMClient, LLMRequest, LLMResponse } from "../src/core/llm.js";
import { toProcessingResult } from "../src/core/result.js";
import { RunStore } from "../src/core/RunStore.js";
import type { GuardConfig, ToolDef } from "../src/core/types.js";
import { createApp } from "../src/http/routes.js";

const usage = { input: 10, output: 5 };
const toolUse = (name: string, input: unknown, id = "tu_1"): LLMResponse => ({
  content: [{ type: "tool_use", id, name, input } as never],
  stopReason: "tool_use",
  usage,
});
/** Respuesta final válida: un AgentReport JSON cuyo summary es `summary`. */
const finalText = (summary: string): LLMResponse => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({
        category: "GENERAL",
        summary,
        outcome: "NO_ACTION_NEEDED",
        findings: [],
        suggestedNextStep: "Sin acción",
      }),
    } as never,
  ],
  stopReason: "end_turn",
  usage,
});

class MockLLM implements LLMClient {
  calls: LLMRequest[] = [];
  constructor(private script: LLMResponse[]) {}
  async complete(req: LLMRequest): Promise<LLMResponse> {
    this.calls.push(structuredClone(req));
    const next = this.script.shift();
    if (!next) throw new Error("script exhausted");
    return next;
  }
}

function setup(script: LLMResponse[], config: GuardConfig = companyConfig) {
  const llm = new MockLLM(script);
  const store = new RunStore();
  const agent = createGuardedAgent({ config, llm, inspector: new StubInspector(), store });
  return { llm, store, agent };
}

/** Config con el handler de una tool reemplazado por un espía. */
function spyOn(toolName: string) {
  const handler = vi.fn(async () => ({}));
  const tools = companyConfig.tools.map((t) => (t.name === toolName ? { ...t, handler } : t));
  return { handler, config: { ...companyConfig, tools } as GuardConfig };
}

const lastToolResult = (llm: MockLLM) =>
  (llm.calls.at(-1)!.messages.at(-1)!.content as { content: string; is_error?: boolean }[])[0]!;

describe("tools de NovaShop", () => {
  it("registra exactamente las cinco herramientas", () => {
    expect(companyConfig.tools.map((t) => t.name).sort()).toEqual(
      ["flagForReview", "getOrderStatus", "readEmail", "readInternalDocument", "tagEmail"].sort(),
    );
  });

  it("getOrderStatus: pedido existente devuelve su estado y no pasa por el inspector", async () => {
    const { agent, llm } = setup([toolUse("getOrderStatus", { orderId: "ORD-1001" }), finalText("ok")]);
    const { run, done } = agent.start("email-order-status");
    await done;
    expect(lastToolResult(llm).content).toContain("IN_TRANSIT");
    expect(run.events.some((e) => e.eventType === "INSPECTION")).toBe(false);
  });

  it("getOrderStatus: pedido inexistente es NOT_FOUND, no una denegación", async () => {
    const { agent, llm } = setup([toolUse("getOrderStatus", { orderId: "ORD-9999" }), finalText("ok")]);
    const { run, done } = agent.start("email-order-not-found");
    await done;
    expect(lastToolResult(llm).content).toContain("NOT_FOUND");
    expect(lastToolResult(llm).is_error).toBeUndefined();
    expect(run.events.some((e) => e.decision === "DENY")).toBe(false);
  });

  it("readInternalDocument: return-policy permitido", async () => {
    const { agent, llm } = setup([toolUse("readInternalDocument", { documentId: "return-policy" }), finalText("ok")]);
    const { run, done } = agent.start("email-order-and-return");
    await done;
    expect(lastToolResult(llm).content).toContain("30 días");
    expect(run.events.find((e) => e.eventType === "POLICY_DECISION")?.decision).toBe("ALLOW");
  });

  it("readInternalDocument('payroll-private'): DENY y el handler nunca se ejecuta", async () => {
    const { handler, config } = spyOn("readInternalDocument");
    const { agent, llm } = setup(
      [toolUse("readInternalDocument", { documentId: "payroll-private" }), finalText("ok")],
      config,
    );
    const { run, done } = agent.start("email-injection-obvious");
    await done;

    expect(handler).not.toHaveBeenCalled();
    expect(run.events.find((e) => e.decision === "DENY")?.reason).toBe("document not permitted");
    expect(run.events.some((e) => e.eventType === "TOOL_EXECUTED")).toBe(false);
    expect(lastToolResult(llm).is_error).toBe(true);
    expect(JSON.stringify(llm.calls.at(-1)!.messages)).not.toContain("Empleado ficticio");
  });

  it("tagEmail: categoría registrada queda en los efectos de la corrida", async () => {
    const { agent } = setup([toolUse("tagEmail", { emailId: "email-order-status", category: "SUPPORT" }), finalText("ok")]);
    const { run, done } = agent.start("email-order-status");
    await done;
    expect(run.effects.tags).toEqual([{ emailId: "email-order-status", category: "SUPPORT" }]);
  });

  it("tagEmail: categoría no registrada se rechaza sin ejecutar el handler", async () => {
    const { handler, config } = spyOn("tagEmail");
    const { agent } = setup([toolUse("tagEmail", { emailId: "email-order-status", category: "HACKED" }), finalText("ok")], config);
    const { run, done } = agent.start("email-order-status");
    await done;
    expect(handler).not.toHaveBeenCalled();
    expect(run.effects.tags).toEqual([]);
  });

  it("tagEmail / flagForReview sobre OTRO email: DENY y sin efectos", async () => {
    const { agent } = setup([
      toolUse("tagEmail", { emailId: "email-bank-change", category: "FINANCE" }, "tu_1"),
      toolUse("flagForReview", { emailId: "email-bank-change", reason: "x" }, "tu_2"),
      finalText("ok"),
    ]);
    const { run, done } = agent.start("email-order-status");
    await done;
    const denies = run.events.filter((e) => e.decision === "DENY");
    expect(denies.map((e) => e.tool)).toEqual(["tagEmail", "flagForReview"]);
    expect(denies.every((e) => e.reason === "resource outside run scope")).toBe(true);
    expect(run.effects).toEqual({ tags: [], reviews: [] });
  });

  it("flagForReview: registra la derivación en los efectos de la corrida", async () => {
    const { agent } = setup([
      toolUse("flagForReview", { emailId: "email-bank-change", reason: "Solicitud de cambio bancario" }),
      finalText("ok"),
    ]);
    const { run, done } = agent.start("email-bank-change");
    await done;
    expect(run.effects.reviews).toEqual([
      { emailId: "email-bank-change", reason: "Solicitud de cambio bancario" },
    ]);
  });

  it("los efectos están aislados entre corridas", async () => {
    const store = new RunStore();
    const mk = (script: LLMResponse[]) =>
      createGuardedAgent({ config: companyConfig, llm: new MockLLM(script), inspector: new StubInspector(), store });
    const a = mk([toolUse("tagEmail", { emailId: "email-order-status", category: "SUPPORT" }), finalText("ok")]).start("email-order-status");
    await a.done;
    const b = mk([finalText("ok")]).start("email-order-status");
    await b.done;
    expect(a.run.effects.tags).toHaveLength(1);
    expect(b.run.effects.tags).toHaveLength(0);
  });

  it("el agente puede elegir secuencias distintas por correo (readEmail seguido de tools diferentes)", async () => {
    const seq = async (emailId: string, tools: [string, unknown][]) => {
      const script = [
        toolUse("readEmail", { emailId }, "tu_0"),
        ...tools.map(([n, i], k) => toolUse(n, i, `tu_${k + 1}`)),
        finalText("ok"),
      ];
      const { agent } = setup(script);
      const { run, done } = agent.start(emailId);
      await done;
      return run.events.filter((e) => e.eventType === "TOOL_EXECUTED").map((e) => e.tool);
    };
    expect(await seq("email-order-status", [["getOrderStatus", { orderId: "ORD-1001" }]])).toEqual(["readEmail", "getOrderStatus"]);
    expect(await seq("email-bank-change", [["flagForReview", { emailId: "email-bank-change", reason: "r" }]])).toEqual(["readEmail", "flagForReview"]);
  });
});

// ---- Inc. 1b: AgentReport, estado final y ProcessingResult ----

const rawText = (text: string): LLMResponse => ({
  content: [{ type: "text", text } as never],
  stopReason: "end_turn",
  usage,
});
const report = (outcome: string, extra: Record<string, unknown> = {}) =>
  rawText(
    "```json\n" +
      JSON.stringify({
        category: "SUPPORT",
        summary: "Resumen",
        outcome,
        findings: ["f"],
        suggestedNextStep: "Comunicar estado",
        ...extra,
      }) +
      "\n```",
  );

describe("AgentReport y estado final", () => {
  it("pedido encontrado: PROCESSED + INFORMATION_FOUND, informe validado y tolerante a ```json", async () => {
    const { agent } = setup([
      toolUse("readEmail", { emailId: "email-order-status" }, "t1"),
      toolUse("getOrderStatus", { orderId: "ORD-1001" }, "t2"),
      report("INFORMATION_FOUND"),
    ]);
    const { run, done } = agent.start("email-order-status");
    await done;
    expect(run.status).toBe("PROCESSED");
    expect(run.agentReport?.outcome).toBe("INFORMATION_FOUND");
    expect(run.events.some((e) => e.eventType === "REPORT_CHECK")).toBe(false);
  });

  it("pedido inexistente: INFORMATION_UNAVAILABLE queda PROCESSED", async () => {
    const { agent } = setup([
      toolUse("getOrderStatus", { orderId: "ORD-9999" }, "t1"),
      report("INFORMATION_UNAVAILABLE"),
    ]);
    const { run, done } = agent.start("email-order-not-found");
    await done;
    expect(run.status).toBe("PROCESSED");
    expect(run.agentReport?.outcome).toBe("INFORMATION_UNAVAILABLE");
  });

  it("INFORMATION_FOUND sobre un pedido NOT_FOUND contradice la evidencia: NEEDS_REVIEW + REPORT_CHECK", async () => {
    const { agent } = setup([
      toolUse("getOrderStatus", { orderId: "ORD-9999" }, "t1"),
      report("INFORMATION_FOUND"),
    ]);
    const { run, done } = agent.start("email-order-not-found");
    await done;
    expect(run.status).toBe("NEEDS_REVIEW");
    expect(run.agentReport?.outcome).toBe("INFORMATION_FOUND"); // no se altera el informe
    expect(run.events.find((e) => e.eventType === "REPORT_CHECK")?.reason).toContain("INFORMATION_FOUND");
  });

  it("flagForReview ejecutado: NEEDS_REVIEW y ESCALATED respaldado", async () => {
    const { agent } = setup([
      toolUse("flagForReview", { emailId: "email-bank-change", reason: "Cambio bancario" }, "t1"),
      report("ESCALATED", { category: "FINANCE" }),
    ]);
    const { run, done } = agent.start("email-bank-change");
    await done;
    expect(run.status).toBe("NEEDS_REVIEW");
    expect(run.agentReport?.outcome).toBe("ESCALATED");
    expect(run.events.some((e) => e.eventType === "REPORT_CHECK")).toBe(false);
  });

  it("ESCALATED sin flagForReview: NEEDS_REVIEW por discrepancia", async () => {
    const { agent } = setup([report("ESCALATED")]);
    const { run, done } = agent.start("email-bank-change");
    await done;
    expect(run.status).toBe("NEEDS_REVIEW");
    expect(run.events.some((e) => e.eventType === "REPORT_CHECK")).toBe(true);
  });

  it("DENY de recurso (payroll-private): el incidente deriva a NEEDS_REVIEW", async () => {
    const { agent } = setup([
      toolUse("readInternalDocument", { documentId: "payroll-private" }, "t1"),
      report("NO_ACTION_NEEDED"),
    ]);
    const { run, done } = agent.start("email-injection-obvious");
    await done;
    expect(run.status).toBe("NEEDS_REVIEW");
    expect(toProcessingResult(run).security.deniedActions).toBe(1);
  });

  it("informe inválido: reintenta una vez y se recupera", async () => {
    const { agent, llm } = setup([rawText("Listo, todo resuelto."), report("NO_ACTION_NEEDED")]);
    const { run, done } = agent.start("email-info-general");
    await done;
    expect(llm.calls).toHaveLength(2);
    expect(JSON.stringify(llm.calls[1]!.messages.at(-1))).toContain("AgentReport JSON válido");
    expect(run.status).toBe("PROCESSED");
    expect(run.agentReport).not.toBeNull();
  });

  it("informe inválido dos veces: FAILED sin informe", async () => {
    const { agent } = setup([rawText("texto libre"), rawText('{"category":"NOPE"}')]);
    const { run, done } = agent.start("email-info-general");
    await done;
    expect(run.status).toBe("FAILED");
    expect(run.failureReason).toBe("invalid agent report");
    expect(run.agentReport).toBeNull();
  });
});

describe("ProcessingResult y API", () => {
  it("toProcessingResult: contrato completo; el stub no se presenta como LOW", async () => {
    const { agent } = setup([toolUse("readEmail", { emailId: "email-info-general" }, "t1"), report("NO_ACTION_NEEDED")]);
    const { run, done } = agent.start("email-info-general");
    await done;
    const r = toProcessingResult(run);
    expect(Object.keys(r).sort()).toEqual(
      ["agentReport", "emailId", "events", "mode", "runId", "security", "status"].sort(),
    );
    expect(r.mode).toBe("PROTECTED");
    expect(r.security.risk).toBe("NOT_ANALYZED");
  });

  it("GET /emails no expone cuerpos; GET /runs/:id devuelve ProcessingResult", async () => {
    const { agent, store } = setup([report("NO_ACTION_NEEDED")]);
    const server = createApp(agent, store).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const emails = (await (await fetch(`${base}/emails`)).json()) as Record<string, unknown>[];
      expect(emails.length).toBeGreaterThanOrEqual(5);
      expect(emails.every((e) => !("textBody" in e) && !("body" in e))).toBe(true);

      const { run, done } = agent.start("email-info-general");
      await done;
      const got = (await (await fetch(`${base}/runs/${run.id}`)).json()) as { status: string; agentReport: unknown; security: unknown };
      expect(got.status).toBe("PROCESSED");
      expect(got.agentReport).not.toBeNull();
      expect(got.security).toBeDefined();
    } finally {
      server.close();
    }
  });
});
