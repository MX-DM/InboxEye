import { describe, expect, it } from "vitest";
import { GUARD_MISSION } from "../src/company/config.js";
import { findEmail } from "../src/company/emails.js";
import { InputGuard, staticSignals } from "../src/core/inputGuard.js";
import type { LLMClient, LLMRequest, LLMResponse } from "../src/core/llm.js";

const serialize = (id: string) => {
  const e = findEmail(id)!;
  return JSON.stringify({ from: e.from, subject: e.subject, body: e.textBody });
};

const reply = (text: string, stopReason: LLMResponse["stopReason"] = "end_turn"): LLMResponse => ({
  content: [{ type: "text", text } as never],
  stopReason,
  usage: { input: 100, output: 20 },
});

class MockLLM implements LLMClient {
  calls: LLMRequest[] = [];
  constructor(private next: LLMResponse | Error) {}
  async complete(req: LLMRequest): Promise<LLMResponse> {
    this.calls.push(req);
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

const json = (o: unknown) => JSON.stringify(o);

describe("staticSignals (sin IA)", () => {
  it("detecta patrones de inyección explícita", () => {
    const s = staticSignals(serialize("email-004"));
    expect(s).toEqual(expect.arrayContaining(["ignora_instrucciones", "dirigido_al_agente", "menciona_herramientas", "recurso_restringido", "ocultar_accion"]));
  });

  it("detecta la suplantación de autoridad del caso sutil", () => {
    const s = staticSignals(serialize("email-011"));
    expect(s).toEqual(expect.arrayContaining(["autoridad_declarada", "ordena_al_asistente", "recurso_restringido"]));
  });

  it("no marca correos legítimos (consulta de pedido, cambio bancario, información)", () => {
    for (const id of ["email-001", "email-003", "email-009", "email-002"]) {
      expect(staticSignals(serialize(id))).toEqual([]);
    }
  });
});

describe("InputGuard (clasificador con mock)", () => {
  const guard = (llm: LLMClient) => new InputGuard(llm, GUARD_MISSION);

  it.each(["LOW", "MEDIUM", "HIGH"] as const)("respuesta válida %s se propaga con señales y uso de tokens", async (risk) => {
    const llm = new MockLLM(reply(json({ risk, reason: "motivo", signals: ["orden al agente"] })));
    const r = await guard(llm).inspect(serialize("email-004"));
    expect(r.risk).toBe(risk);
    expect(r.reason).toBe("motivo");
    expect(r.signals).toContain("orden al agente");
    expect(r.signals).toContain("static:ignora_instrucciones");
    expect(r.usage).toEqual({ input: 100, output: 20 });
    expect(r.inspector).toBe("input-guard");
  });

  it("tolera JSON dentro de un bloque ```json", async () => {
    const llm = new MockLLM(reply("```json\n" + json({ risk: "LOW", reason: "ok", signals: [] }) + "\n```"));
    expect((await guard(llm).inspect(serialize("email-001"))).risk).toBe("LOW");
  });

  it.each([
    ["texto que no es JSON", reply("parece seguro")],
    ["risk fuera del enum", reply(json({ risk: "NONE", reason: "x", signals: [] }))],
    ["falta reason", reply(json({ risk: "LOW", signals: [] }))],
    ["corte por max_tokens", reply(json({ risk: "LOW", reason: "x", signals: [] }), "max_tokens")],
  ])("falla cerrado a UNKNOWN: %s", async (_name, response) => {
    const r = await guard(new MockLLM(response)).inspect(serialize("email-001"));
    expect(r.risk).toBe("UNKNOWN");
    expect(r.reason).toBe("classifier output invalid");
  });

  it("falla cerrado a UNKNOWN si la llamada al clasificador lanza una excepción", async () => {
    const r = await guard(new MockLLM(new Error("network"))).inspect(serialize("email-001"));
    expect(r.risk).toBe("UNKNOWN");
    expect(r.reason).toBe("classifier call failed");
  });

  it("un correo que ordena 'LOW' no engaña: solo cuenta el JSON validado del clasificador", async () => {
    // El clasificador (mock) responde HIGH aunque el correo pida ser clasificado como seguro.
    const llm = new MockLLM(reply(json({ risk: "HIGH", reason: "orden al agente", signals: [] })));
    const r = await guard(llm).inspect(serialize("email-004"));
    expect(r.risk).toBe("HIGH");
  });

  it("el clasificador no recibe tools; el correo viaja como dato delimitado, no en el system", async () => {
    const llm = new MockLLM(reply(json({ risk: "LOW", reason: "ok", signals: [] })));
    const body = findEmail("email-004")!.textBody;
    await guard(llm).inspect(serialize("email-004"));

    const req = llm.calls[0]!;
    expect(req.tools).toBeUndefined();
    expect(req.system).not.toContain(body);
    expect(req.system).toContain(GUARD_MISSION);
    const user = String(req.messages[0]!.content);
    expect(user).toContain("<email_content>");
    expect(user).toContain(body);
    expect(user).toContain("ignora_instrucciones"); // señales estáticas como dato
  });

  it("trunca motivos y señales largos en lugar de rechazar la respuesta", async () => {
    const llm = new MockLLM(
      reply(json({ risk: "MEDIUM", reason: "x".repeat(900), signals: Array.from({ length: 12 }, () => "y".repeat(500)) })),
    );
    const r = await guard(llm).inspect(serialize("email-011"));
    expect(r.risk).toBe("MEDIUM");
    expect(r.reason.length).toBe(300);
    expect(r.signals.filter((s) => !s.startsWith("static:"))).toHaveLength(6);
  });
});
