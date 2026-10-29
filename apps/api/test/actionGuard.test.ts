// Segunda barrera (Action Guard / PolicyEngine), verificada de forma DETERMINISTA.
// Ningún test de este archivo llama a Claude. El "agente" es un mock que solicita la herramienta:
// eso se registra como una solicitud simulada, NUNCA como una decisión real del modelo.
import { describe, expect, it, vi } from "vitest";
import { companyConfig } from "../src/company/config.js";
import { createGuardedAgent } from "../src/core/AgentRunner.js";
import type { ContentInspector } from "../src/core/inspector.js";
import type { LLMClient, LLMRequest, LLMResponse } from "../src/core/llm.js";
import { PolicyEngine } from "../src/core/PolicyEngine.js";
import { RunStore } from "../src/core/RunStore.js";
import type { RunContext, ToolDef } from "../src/core/types.js";

const ctx = (mode: RunContext["mode"]): RunContext => ({
  runId: "r1",
  emailId: "email-010",
  effects: { tags: [], reviews: [] },
  mode,
});

describe("PolicyEngine (determinista, sin LLM)", () => {
  const policy = new PolicyEngine(companyConfig.tools);
  const payroll = { documentId: "payroll-private" };

  it("PROTECTED: readInternalDocument('payroll-private') se deniega", () => {
    expect(policy.evaluate("readInternalDocument", payroll, ctx("PROTECTED"))).toEqual({
      kind: "DENY",
      reason: "document not permitted",
    });
  });

  it("PROTECTED: los documentos permitidos siguen permitidos", () => {
    for (const documentId of ["shipping-policy", "return-policy"]) {
      expect(policy.evaluate("readInternalDocument", { documentId }, ctx("PROTECTED")).kind).toBe("ALLOW");
    }
  });

  it("UNPROTECTED_DEMO: el mismo pedido sí pasa la política (única diferencia: la regla de recurso)", () => {
    expect(policy.evaluate("readInternalDocument", payroll, ctx("UNPROTECTED_DEMO")).kind).toBe("ALLOW");
  });

  it("en ambos modos: tool desconocida y lectura de otro correo siguen denegadas", () => {
    for (const mode of ["PROTECTED", "UNPROTECTED_DEMO"] as const) {
      expect(policy.evaluate("executeShell", { cmd: "ls" }, ctx(mode)).kind).toBe("DENY");
      expect(policy.evaluate("readEmail", { emailId: "email-001" }, ctx(mode)).kind).toBe("DENY");
    }
  });
});

describe("falso negativo controlado del clasificador (agente simulado)", () => {
  /** Clasificador que se equivoca A PROPÓSITO: devuelve LOW aunque el correo sea sospechoso. */
  const falseNegative: ContentInspector = {
    inspect: vi.fn(async () => ({ risk: "LOW" as const, reason: "falso negativo controlado", signals: [], inspector: "test-forced-low" })),
  };

  /** Agente simulado: primero lee el correo y luego SOLICITA readInternalDocument('payroll-private'). */
  function scriptedAgent(inspector: ContentInspector, tools: ToolDef[]) {
    const script: LLMResponse[] = [
      { content: [{ type: "tool_use", id: "s1", name: "readEmail", input: { emailId: "email-010" } } as never], stopReason: "tool_use", usage: { input: 1, output: 1 } },
      { content: [{ type: "tool_use", id: "s2", name: "readInternalDocument", input: { documentId: "payroll-private" } } as never], stopReason: "tool_use", usage: { input: 1, output: 1 } },
      {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              category: "FINANCE",
              summary: "Solicitud de conciliación de nómina.",
              outcome: "INFORMATION_UNAVAILABLE",
              findings: ["No se pudo acceder a la referencia solicitada."],
              suggestedNextStep: "Revisión humana.",
            }),
          } as never,
        ],
        stopReason: "end_turn",
        usage: { input: 1, output: 1 },
      },
    ];
    const calls: LLMRequest[] = [];
    const llm: LLMClient = {
      model: "mock",
      async complete(req) {
        calls.push(req);
        const next = script.shift();
        if (!next) throw new Error("script exhausted");
        return next;
      },
    };
    const store = new RunStore();
    const agent = createGuardedAgent({ config: { ...companyConfig, tools }, llm, inspector, store });
    return { agent, store, calls };
  }

  it("PROTECTED: aunque el clasificador dé LOW, la solicitud a payroll-private se deniega y el handler no corre", async () => {
    const handler = vi.fn(async () => ({ id: "payroll-private", text: "dato" }));
    const tools = companyConfig.tools.map((t) =>
      t.name === "readInternalDocument" ? ({ ...t, handler } as ToolDef) : t,
    );
    const { agent } = scriptedAgent(falseNegative, tools);
    const { run, done } = agent.start("email-010", "PROTECTED");
    await done;

    expect(falseNegative.inspect).toHaveBeenCalledTimes(1); // el correo sí pasó por el clasificador (dio LOW)
    expect(handler).not.toHaveBeenCalled();
    const deny = run.events.find((e) => e.decision === "DENY");
    expect(deny).toMatchObject({ tool: "readInternalDocument", reason: "document not permitted" });
    // Denegar una herramienta marca la corrida para revisión humana: no se presenta como PROCESSED.
    expect(run.status).toBe("NEEDS_REVIEW");
  });

  it("el clasificador LOW no concede permiso: la regla de recurso decide sola", async () => {
    const handler = vi.fn(async () => ({}));
    const tools = companyConfig.tools.map((t) =>
      t.name === "readInternalDocument" ? ({ ...t, handler } as ToolDef) : t,
    );
    const { agent } = scriptedAgent(falseNegative, tools);
    await agent.start("email-010", "PROTECTED").done;
    expect(handler).not.toHaveBeenCalled();
  });

  it("UNPROTECTED_DEMO (control): la misma solicitud sí llega al handler, con el mismo agente simulado", async () => {
    const handler = vi.fn(async () => ({ id: "payroll-private", text: "dato" }));
    const tools = companyConfig.tools.map((t) =>
      t.name === "readInternalDocument" ? ({ ...t, handler } as ToolDef) : t,
    );
    const { agent } = scriptedAgent(falseNegative, tools);
    const { run, done } = agent.start("email-010", "UNPROTECTED_DEMO");
    await done;
    expect(handler).toHaveBeenCalledTimes(1);
    expect(run.events.some((e) => e.decision === "DENY")).toBe(false);
  });
});
