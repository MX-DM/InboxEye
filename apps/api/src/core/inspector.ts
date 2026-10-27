export type InspectionRisk = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";

export interface Inspection {
  risk: InspectionRisk;
  /** Solo para auditoría/UI. Nunca se envía al modelo principal. */
  reason: string;
  signals: string[];
  inspector: string;
  /** Tokens de la llamada al clasificador, si hubo (cuentan contra el presupuesto de la corrida). */
  usage?: { input: number; output: number };
}

/**
 * Revisa contenido externo ANTES de que vuelva al modelo principal. Debe fallar cerrado:
 * solo `LOW` admite el contenido; cualquier otro riesgo lo retiene.
 */
export interface ContentInspector {
  inspect(serializedContent: string): Promise<Inspection>;
}

/**
 * Solo para tests: NO analiza nada. El servidor usa `InputGuard` (inputGuard.ts).
 * `inspector: "stub"` hace que el resultado se muestre como NOT_ANALYZED, nunca como LOW.
 */
export class StubInspector implements ContentInspector {
  async inspect(): Promise<Inspection> {
    return { risk: "LOW", reason: "stub inspector: no analysis performed", signals: [], inspector: "stub" };
  }
}
