// Anonimato del experimento: el agente y la API no deben recibir ni revelar etiquetas internas de los casos,
// y cada corrida debe registrar exactamente un evento de entrega (entregado O retenido).
import { describe, expect, it, vi } from "vitest";
import { companyConfig } from "../src/company/config.js";
import { EMAILS } from "../src/company/emails.js";
import { createGuardedAgent } from "../src/core/AgentRunner.js";
import type { ContentInspector } from "../src/core/inspector.js";
import type { LLMClient, LLMRequest, LLMResponse } from "../src/core/llm.js";
import { RunStore } from "../src/core/RunStore.js";
import { createApp } from "../src/http/routes.js";

const usage = { input: 1, output: 1 };
const readEmailThen = (id: string): LLMResponse[] => [
  { content: [{ type: "tool_use", id: "t1", name: "readEmail", input: { emailId: id } } as never], stopReason: "tool_use", usage },
  {
    content: [{ type: "text", text: JSON.stringify({ category: "GENERAL", summary: "x", outcome: "NO_ACTION_NEEDED", findings: [], suggestedNextStep: "x" }) } as never],
    stopReason: "end_turn",
    usage,
  },
];

function llmWith(script: LLMResponse[]) {
  const calls: LLMRequest[] = [];
  const llm: LLMClient = {
    model: "mock",
    async complete(req) {
      calls.push(JSON.parse(JSON.stringify(req)));
      const next = script.shift();
      if (!next) throw new Error("script exhausted");
      return next;
    },
  };
  return { llm, calls };
}

const pass: ContentInspector = { inspect: vi.fn(async () => ({ risk: "LOW" as const, reason: "t", signals: [], inspector: "test" })) };
const block: ContentInspector = { inspect: vi.fn(async () => ({ risk: "HIGH" as const, reason: "t", signals: [], inspector: "test" })) };

describe("anonimato de los casos", () => {
  it("los IDs son opacos: ninguno describe el contenido del correo", () => {
    for (const e of EMAILS) {
      expect(e.id).toMatch(/^email-\d{3}$/);
      expect(e.id).not.toContain(e.label);
    }
  });

  it("ninguna etiqueta interna aparece en lo que recibe el modelo, para CADA correo", async () => {
    for (const e of EMAILS) {
      const { llm, calls } = llmWith(readEmailThen(e.id));
      const store = new RunStore();
      const agent = createGuardedAgent({ config: companyConfig, llm, inspector: pass, store });
      await agent.start(e.id).done;
      const sent = JSON.stringify(calls);
      expect(sent).not.toContain(e.label);
      expect(sent).not.toMatch(/injection|quarter|subtle|obvious/i);
    }
  });

  it("ninguna etiqueta aparece en los endpoints de la API", async () => {
    const llm = llmWith([]).llm;
    const store = new RunStore();
    const agent = createGuardedAgent({ config: companyConfig, llm, inspector: pass, store });
    const server = createApp(agent, store).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const all = await (await fetch(`${base}/emails`)).text();
      for (const e of EMAILS) {
        expect(all).not.toContain(e.label);
        const one = await (await fetch(`${base}/emails/${e.id}`)).text();
        expect(one).not.toContain(e.label);
      }
    } finally {
      server.close();
    }
  });
});

describe("trazabilidad de la entrega del contenido", () => {
  it("contenido admitido: CONTENT_DELIVERED y ningún CONTENT_WITHHELD", async () => {
    const { llm } = llmWith(readEmailThen("email-009"));
    const store = new RunStore();
    const agent = createGuardedAgent({ config: companyConfig, llm, inspector: pass, store });
    const { run, done } = agent.start("email-009");
    await done;
    const types = run.events.map((e) => e.eventType);
    expect(types.filter((t) => t === "CONTENT_DELIVERED")).toHaveLength(1);
    expect(types).not.toContain("CONTENT_WITHHELD");
    expect(run.events.find((e) => e.eventType === "INSPECTION")?.detail).toMatchObject({ enabled: true, risk: "LOW" });
  });

  it("contenido retenido: CONTENT_WITHHELD y ningún CONTENT_DELIVERED", async () => {
    const { llm, calls } = llmWith([readEmailThen("email-004")[0]!]);
    const store = new RunStore();
    const agent = createGuardedAgent({ config: companyConfig, llm, inspector: block, store });
    const { run, done } = agent.start("email-004");
    await done;
    const types = run.events.map((e) => e.eventType);
    expect(types).toContain("CONTENT_WITHHELD");
    expect(types).not.toContain("CONTENT_DELIVERED");
    expect(calls).toHaveLength(1); // el agente no recibió nada más
  });

  it("sin protección: INSPECTION con enabled=false y CONTENT_DELIVERED", async () => {
    const { llm } = llmWith(readEmailThen("email-011"));
    const store = new RunStore();
    const agent = createGuardedAgent({ config: companyConfig, llm, inspector: block, store });
    const { run, done } = agent.start("email-011", "UNPROTECTED_DEMO");
    await done;
    expect(block.inspect).not.toHaveBeenCalled();
    expect(run.events.find((e) => e.eventType === "INSPECTION")?.detail).toMatchObject({ enabled: false });
    const types = run.events.map((e) => e.eventType);
    expect(types).toContain("CONTENT_DELIVERED");
    expect(types).not.toContain("CONTENT_WITHHELD");
  });

  it("la huella de configuración es igual en ambos modos (mismo prompt y herramientas)", async () => {
    const started = async (mode: "PROTECTED" | "UNPROTECTED_DEMO") => {
      const { llm } = llmWith(readEmailThen("email-001"));
      const agent = createGuardedAgent({ config: companyConfig, llm, inspector: pass, store: new RunStore() });
      const { run, done } = agent.start("email-001", mode);
      await done;
      return run.events.find((e) => e.eventType === "RUN_STARTED")?.detail;
    };
    const p = await started("PROTECTED");
    const u = await started("UNPROTECTED_DEMO");
    expect(p?.objectiveHash).toBe(u?.objectiveHash);
    expect(p?.toolsHash).toBe(u?.toolsHash);
  });
});
