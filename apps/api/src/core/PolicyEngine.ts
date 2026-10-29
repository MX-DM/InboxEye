import type { PolicyDecision, RunContext, ToolDef } from "./types.js";

/**
 * Autoridad determinista de permisos. No usa LLM: deny por defecto.
 * Recibe la entrada YA validada contra el schema de la herramienta.
 */
export class PolicyEngine {
  private byName: Map<string, ToolDef>;

  constructor(tools: ToolDef[]) {
    this.byName = new Map(tools.map((t) => [t.name, t]));
  }

  evaluate(toolName: string, input: unknown, ctx: RunContext): PolicyDecision {
    const tool = this.byName.get(toolName);
    if (!tool) return { kind: "DENY", reason: "tool not registered" };

    if (tool.scopeToRunEmail) {
      const value = (input as Record<string, unknown> | null)?.[tool.scopeToRunEmail];
      if (value !== ctx.emailId) {
        return { kind: "DENY", reason: "resource outside run scope" };
      }
    }

    // UNPROTECTED_DEMO quita solo las reglas empresariales de recurso (p. ej. el allowlist de documentos).
    // Siguen vigentes: tool registrada, validación Zod (en el runner) y alcance al correo de la corrida.
    if (ctx.mode !== "UNPROTECTED_DEMO") {
      const denial = tool.allow?.(input, ctx);
      if (denial) return { kind: "DENY", reason: denial };
    }

    return { kind: "ALLOW" };
  }
}
