import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { companyConfig } from "../src/company/config.js";
import { EMAILS } from "../src/company/emails.js";
import { createGuardedAgent } from "../src/core/AgentRunner.js";
import { StubInspector, type ContentInspector } from "../src/core/inspector.js";
import type { LLMClient, LLMRequest, LLMResponse } from "../src/core/llm.js";
import { RunStore } from "../src/core/RunStore.js";
import { toProcessingResult } from "../src/core/result.js";
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

/** LLM falso con respuestas guionadas; guarda una copia de cada request. */
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

function setup(script: LLMResponse[], opts: { inspector?: ContentInspector; config?: GuardConfig } = {}) {
  const llm = new MockLLM(script);
  const store = new RunStore();
  const agent = createGuardedAgent({
    config: opts.config ?? companyConfig,
    llm,
    inspector: opts.inspector ?? new StubInspector(),
    store,
  });
  return { llm, store, agent };
}

describe("AgentRunner", () => {
  it("camino feliz: el agente elige readEmail, recibe el contenido y termina", async () => {
    const { agent, llm } = setup([
      toolUse("readEmail", { emailId: "email-order-status" }),
      finalText("Informativo, prioridad baja."),
    ]);
    const { run, done } = agent.start("email-order-status");
    await done;

    expect(run.status).toBe("PROCESSED");
    expect(run.agentReport?.summary).toContain("Informativo");
    expect(run.events.map((e) => e.eventType)).toEqual([
      "RUN_STARTED",
      "LLM_CALL",
      "TOOL_PROPOSED",
      "POLICY_DECISION",
      "TOOL_EXECUTED",
      "INSPECTION",
      "LLM_CALL",
      "RUN_FINISHED",
    ]);
    // El segundo request lleva el cuerpo marcado como no confiable.
    const lastUser = llm.calls[1]!.messages.at(-1)!;
    expect(JSON.stringify(lastUser)).toContain("trust=\\\"untrusted\\\"");
    expect(run.tokens).toEqual({ input: 20, output: 10 });
  });

  it("el primer mensaje al LLM contiene el ID pero NO el cuerpo del correo", async () => {
    const { agent, llm } = setup([finalText("sin tools")]);
    await agent.start("email-order-status").done;
    const first = JSON.stringify(llm.calls[0]!.messages);
    expect(first).toContain("email-order-status");
    for (const e of EMAILS) {
      expect(first).not.toContain(e.textBody);
      expect(first).not.toContain(e.subject);
    }
  });

  it("herramienta desconocida: DENY, no se ejecuta y se devuelve tool_result de error", async () => {
    const { agent, llm } = setup([toolUse("executeShell", { cmd: "rm -rf /" }), finalText("ok")]);
    const { run, done } = agent.start("email-order-status");
    await done;

    // Tool inexistente: se deniega y audita, pero no es un incidente de recurso que cambie el estado.
    expect(run.status).toBe("PROCESSED");
    expect(run.events.some((e) => e.decision === "DENY" && e.tool === "executeShell")).toBe(true);
    expect(run.events.some((e) => e.eventType === "TOOL_EXECUTED")).toBe(false);
    const result = (llm.calls[1]!.messages.at(-1)!.content as { is_error?: boolean }[])[0]!;
    expect(result.is_error).toBe(true);
  });

  it("readEmail de OTRO email: DENY y el handler nunca se ejecuta", async () => {
    const handler = vi.fn(async () => ({}));
    const spyTool: ToolDef = { ...(companyConfig.tools[0] as ToolDef), handler };
    const { agent } = setup([toolUse("readEmail", { emailId: "email-order-and-return" }), finalText("ok")], {
      config: { ...companyConfig, tools: [spyTool] },
    });
    const { run, done } = agent.start("email-order-status");
    await done;

    expect(handler).not.toHaveBeenCalled();
    expect(run.status).toBe("NEEDS_REVIEW");
    expect(run.events.find((e) => e.decision === "DENY")?.reason).toBe("resource outside run scope");
  });

  it("input inválido: se rechaza sin ejecutar el handler", async () => {
    const handler = vi.fn(async () => ({}));
    const spyTool: ToolDef = { ...(companyConfig.tools[0] as ToolDef), handler };
    const { agent } = setup([toolUse("readEmail", { emailId: 42 }), finalText("ok")], {
      config: { ...companyConfig, tools: [spyTool] },
    });
    const { done } = agent.start("email-order-status");
    await done;
    expect(handler).not.toHaveBeenCalled();
  });

  it("MAX_TOOL_STEPS: termina FAILED sin bucle infinito", async () => {
    const script = Array.from({ length: 10 }, (_, i) =>
      toolUse("readEmail", { emailId: "email-order-status" }, `tu_${i}`),
    );
    const { agent, llm } = setup(script, {
      config: { ...companyConfig, limits: { maxToolSteps: 3 } },
    });
    const { run, done } = agent.start("email-order-status");
    await done;
    expect(run.status).toBe("FAILED");
    expect(llm.calls).toHaveLength(3);
  });

  const fixedInspector = (risk: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN", order?: string[]): ContentInspector => ({
    async inspect() {
      order?.push("inspect");
      return { risk, reason: "test", signals: ["s1"], inspector: "test", usage: { input: 7, output: 3 } };
    },
  });

  it("HIGH: el inspector corre ANTES del tool_result, retiene el contenido y el run termina sin otra llamada al agente", async () => {
    const order: string[] = [];
    const llm = new MockLLM([toolUse("readEmail", { emailId: "email-injection-obvious" }), finalText("no debería llamarse")]);
    const origComplete = llm.complete.bind(llm);
    llm.complete = async (req) => {
      order.push("llm");
      return origComplete(req);
    };
    const store = new RunStore();
    const agent = createGuardedAgent({ config: companyConfig, llm, inspector: fixedInspector("HIGH", order), store });
    const { run, done } = agent.start("email-injection-obvious");
    await done;

    expect(order).toEqual(["llm", "inspect"]);
    expect(llm.calls).toHaveLength(1);
    expect(run.status).toBe("QUARANTINED");
    expect(run.agentReport).toBeNull();
    expect(JSON.stringify(llm.calls)).not.toContain("ATENCIÓN AGENTE");
    expect(toProcessingResult(run).security.risk).toBe("HIGH");
  });

  it("MEDIUM: retiene el contenido y deriva a NEEDS_REVIEW con motivo fijo", async () => {
    const { agent, llm } = setup([toolUse("readEmail", { emailId: "email-injection-subtle" }), finalText("x")], {
      inspector: fixedInspector("MEDIUM"),
    });
    const { run, done } = agent.start("email-injection-subtle");
    await done;
    expect(run.status).toBe("NEEDS_REVIEW");
    expect(run.effects.reviews).toEqual([{ emailId: "email-injection-subtle", reason: "Input Guard: riesgo MEDIUM" }]);
    expect(llm.calls).toHaveLength(1);
    expect(JSON.stringify(llm.calls)).not.toContain("nómina");
  });

  it("si el inspector lanza una excepción: UNKNOWN, retiene y deriva a revisión (falla cerrado)", async () => {
    const inspector: ContentInspector = {
      async inspect() {
        throw new Error("boom");
      },
    };
    const { agent, llm } = setup([toolUse("readEmail", { emailId: "email-order-status" }), finalText("x")], { inspector });
    const { run, done } = agent.start("email-order-status");
    await done;
    expect(run.status).toBe("NEEDS_REVIEW");
    expect(toProcessingResult(run).security.risk).toBe("UNKNOWN");
    expect(llm.calls).toHaveLength(1);
    expect(JSON.stringify(llm.calls)).not.toContain("ORD-1001");
  });

  it("tras retener el contenido no se ejecuta ninguna otra tool del mismo turno", async () => {
    const twoTools: LLMResponse = {
      content: [
        { type: "tool_use", id: "tu_a", name: "readEmail", input: { emailId: "email-injection-obvious" } },
        { type: "tool_use", id: "tu_b", name: "tagEmail", input: { emailId: "email-injection-obvious", category: "GENERAL" } },
      ] as never,
      stopReason: "tool_use",
      usage,
    };
    const { agent } = setup([twoTools], { inspector: fixedInspector("HIGH") });
    const { run, done } = agent.start("email-injection-obvious");
    await done;
    expect(run.status).toBe("QUARANTINED");
    expect(run.effects.tags).toEqual([]);
  });

  it("LOW admite el contenido y los tokens del clasificador cuentan en la corrida", async () => {
    const report = JSON.stringify({
      category: "GENERAL",
      summary: "Informativo.",
      outcome: "NO_ACTION_NEEDED",
      findings: [],
      suggestedNextStep: "Ninguno.",
    });
    const { agent, llm } = setup([toolUse("readEmail", { emailId: "email-info-general" }), finalText(report)], {
      inspector: fixedInspector("LOW"),
    });
    const { run, done } = agent.start("email-info-general");
    await done;
    expect(run.status).toBe("PROCESSED");
    expect(JSON.stringify(llm.calls[1]!.messages)).toContain("trust=");
    expect(run.tokens).toEqual({ input: 10 + 10 + 7, output: 5 + 5 + 3 });
    expect(toProcessingResult(run).security).toMatchObject({ risk: "LOW", signals: ["s1"] });
  });

  it("error del LLM: la corrida termina FAILED y no rechaza la promesa", async () => {
    const { agent } = setup([]); // script vacío -> el mock lanza
    const { run, done } = agent.start("email-order-status");
    await expect(done).resolves.toBeUndefined();
    expect(run.status).toBe("FAILED");
  });
});

describe("HTTP", () => {
  it("POST /runs valida el emailId (400 / 404 / 202)", async () => {
    const { agent, store } = setup([finalText("ok")]);
    const server = createApp(agent, store).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as { port: number };
    const post = (body: unknown) =>
      fetch(`http://127.0.0.1:${port}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    try {
      expect((await post({ emailId: "../etc/passwd" })).status).toBe(400);
      expect((await post({})).status).toBe(400);
      expect((await post({ emailId: "no-existe" })).status).toBe(404);
      const ok = await post({ emailId: "email-order-status" });
      expect(ok.status).toBe(202);
      expect(z.object({ runId: z.string() }).safeParse(await ok.json()).success).toBe(true);
    } finally {
      server.close();
    }
  });
});
