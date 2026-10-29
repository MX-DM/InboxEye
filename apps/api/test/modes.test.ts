import { describe, expect, it, vi } from "vitest";
import { companyConfig } from "../src/company/config.js";
import { findEmail } from "../src/company/emails.js";
import { createGuardedAgent } from "../src/core/AgentRunner.js";
import type { ContentInspector } from "../src/core/inspector.js";
import type { LLMClient, LLMRequest, LLMResponse } from "../src/core/llm.js";
import { RunStore } from "../src/core/RunStore.js";
import { toProcessingResult } from "../src/core/result.js";
import type { ToolDef } from "../src/core/types.js";
import { createApp } from "../src/http/routes.js";

const usage = { input: 10, output: 5 };
const toolUse = (name: string, input: unknown, id = "tu_1"): LLMResponse => ({
  content: [{ type: "tool_use", id, name, input } as never],
  stopReason: "tool_use",
  usage,
});
const finalReport = (): LLMResponse => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({
        category: "GENERAL",
        summary: "Informe de prueba.",
        outcome: "INFORMATION_FOUND",
        findings: ["ok"],
        suggestedNextStep: "Ninguno.",
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

/** Devuelve el agente, el store, el LLM y el espía del handler de readInternalDocument. */
function setup(script: LLMResponse[], inspector?: ContentInspector) {
  const docHandler = vi.fn(async ({ documentId }: { documentId: string }) => ({ id: documentId, text: "texto de prueba" }));
  const tools = companyConfig.tools.map((t) =>
    t.name === "readInternalDocument" ? ({ ...t, handler: docHandler } as ToolDef) : t,
  );
  const llm = new MockLLM(script);
  const store = new RunStore();
  const spyInspector: ContentInspector =
    inspector ?? { inspect: vi.fn(async () => ({ risk: "LOW" as const, reason: "t", signals: [], inspector: "test" })) };
  const agent = createGuardedAgent({ config: { ...companyConfig, tools }, llm, inspector: spyInspector, store });
  return { agent, store, llm, docHandler, inspector: spyInspector };
}

const readPayroll = () => toolUse("readInternalDocument", { documentId: "payroll-private" });

describe("modo PROTECTED vs UNPROTECTED_DEMO", () => {
  it("PROTECTED: payroll-private se deniega y el handler nunca se ejecuta", async () => {
    const { agent, docHandler } = setup([readPayroll(), finalReport()]);
    const { run, done } = agent.start("email-004", "PROTECTED");
    await done;
    expect(docHandler).not.toHaveBeenCalled();
    expect(run.events.some((e) => e.decision === "DENY" && e.tool === "readInternalDocument")).toBe(true);
    expect(run.status).toBe("NEEDS_REVIEW");
  });

  it("UNPROTECTED_DEMO: la misma petición se ejecuta (sin reglas de recurso), sin denegaciones", async () => {
    const { agent, docHandler } = setup([readPayroll(), finalReport()]);
    const { run, done } = agent.start("email-004", "UNPROTECTED_DEMO");
    await done;
    expect(docHandler).toHaveBeenCalledWith({ documentId: "payroll-private" }, expect.anything());
    expect(run.events.some((e) => e.decision === "DENY")).toBe(false);
    expect(run.mode).toBe("UNPROTECTED_DEMO");
  });

  it("UNPROTECTED_DEMO: el Input Guard no se invoca, el contenido llega al agente y la traza lo deja registrado", async () => {
    const { agent, llm, inspector } = setup([toolUse("readEmail", { emailId: "email-004" }), finalReport()]);
    const { run, done } = agent.start("email-004", "UNPROTECTED_DEMO");
    await done;
    expect(inspector.inspect).not.toHaveBeenCalled();
    expect(JSON.stringify(llm.calls[1]!.messages)).toContain(findEmail("email-004")!.textBody.slice(0, 20));
    const insp = run.events.find((e) => e.eventType === "INSPECTION");
    expect(insp?.detail).toMatchObject({ risk: "NOT_ANALYZED", inspector: "none" });
    // Sin análisis: nunca se presenta como LOW.
    expect(toProcessingResult(run).security.risk).toBe("NOT_ANALYZED");
  });

  it("PROTECTED: el mismo correo SÍ pasa por el Input Guard", async () => {
    const { agent, inspector } = setup([toolUse("readEmail", { emailId: "email-009" }), finalReport()]);
    await agent.start("email-009", "PROTECTED").done;
    expect(inspector.inspect).toHaveBeenCalledTimes(1);
  });

  it.each<[string, LLMResponse]>([
    ["tool desconocida", toolUse("executeShell", { cmd: "ls" })],
    ["argumentos inválidos", toolUse("readInternalDocument", { documentId: 42 })],
    ["readEmail de otro correo (alcance)", toolUse("readEmail", { emailId: "email-009" })],
  ])("UNPROTECTED_DEMO sigue rechazando: %s", async (_name, call) => {
    const { agent, docHandler } = setup([call, finalReport()]);
    const { run, done } = agent.start("email-004", "UNPROTECTED_DEMO");
    await done;
    expect(docHandler).not.toHaveBeenCalled();
    expect(run.events.some((e) => e.decision === "DENY")).toBe(true);
    expect(run.events.some((e) => e.eventType === "TOOL_EXECUTED")).toBe(false);
  });

  it("la auditoría registra el modo y el argumento (acotado) de cada tool", async () => {
    const { agent } = setup([toolUse("getOrderStatus", { orderId: "ORD-1001" }), finalReport()]);
    const { run, done } = agent.start("email-001");
    await done;
    // El modelo queda auditado para poder comprobar que las dos corridas comparadas usan el mismo.
    const started = run.events.find((e) => e.eventType === "RUN_STARTED")?.detail;
    expect(started).toMatchObject({ mode: "PROTECTED", model: "desconocido" });
    expect(started?.objectiveHash).toMatch(/^[0-9a-f]{12}$/);
    expect(started?.toolsHash).toMatch(/^[0-9a-f]{12}$/);
    expect(run.events.find((e) => e.eventType === "TOOL_PROPOSED")?.detail).toEqual({ input: '{"orderId":"ORD-1001"}' });
    expect(run.events.find((e) => e.eventType === "TOOL_EXECUTED")?.detail).toEqual({ input: '{"orderId":"ORD-1001"}' });
  });

  it("los argumentos auditados se acotan a 160 caracteres", async () => {
    const long = { emailId: "email-009", reason: "x".repeat(400) };
    const { agent } = setup([toolUse("flagForReview", long), finalReport()]);
    const { run, done } = agent.start("email-009");
    await done;
    const proposed = run.events.find((e) => e.eventType === "TOOL_PROPOSED");
    expect(String(proposed?.detail?.input).length).toBe(160);
  });
});

describe("POST /runs con mode", () => {
  async function withServer(fn: (post: (b: unknown) => Promise<Response>, base: string) => Promise<void>) {
    const { agent, store } = setup([finalReport(), finalReport()]);
    const server = createApp(agent, store).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const post = (b: unknown) =>
      fetch(`${base}/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    try {
      await fn(post, base);
    } finally {
      server.close();
    }
  }

  it("rechaza un modo inválido (400) y acepta los dos válidos; sin modo es PROTECTED", async () => {
    await withServer(async (post, base) => {
      expect((await post({ emailId: "email-009", mode: "ROOT" })).status).toBe(400);

      const withMode = await post({ emailId: "email-009", mode: "UNPROTECTED_DEMO" });
      expect(withMode.status).toBe(202);
      const a = (await (await fetch(`${base}/runs/${((await withMode.json()) as { runId: string }).runId}`)).json()) as { mode: string };
      expect(a.mode).toBe("UNPROTECTED_DEMO");

      const noMode = await post({ emailId: "email-009" });
      const b = (await (await fetch(`${base}/runs/${((await noMode.json()) as { runId: string }).runId}`)).json()) as { mode: string };
      expect(b.mode).toBe("PROTECTED");
    });
  });
});
