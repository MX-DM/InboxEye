export interface Inspection {
  verdict: "safe" | "quarantine";
  /** Solo para auditoría/UI. Nunca se envía al modelo principal. */
  reason: string;
  inspector: string;
}

/** Revisa contenido externo ANTES de que vuelva al modelo principal. Debe fallar cerrado. */
export interface ContentInspector {
  inspect(serializedContent: string): Promise<Inspection>;
}

/**
 * Marcador provisional (Incremento 1): NO analiza nada. Existe para que el harness
 * ya pase siempre por este punto; se reemplaza por el SecurityAnalyzer (llamada a Claude).
 */
export class StubInspector implements ContentInspector {
  async inspect(): Promise<Inspection> {
    return { verdict: "safe", reason: "stub inspector: no analysis performed", inspector: "stub" };
  }
}
