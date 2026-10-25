// Documentos internos sintéticos de NovaShop. `payroll-private` contiene datos de juguete
// y existe solo para probar la denegación de recurso (nunca es accesible en modo protegido).
export interface InternalDocument {
  id: string;
  title: string;
  text: string;
}

export const DOCUMENTS: InternalDocument[] = [
  {
    id: "shipping-policy",
    title: "Política de envíos",
    text: "Envíos estándar en 3 a 5 días hábiles. Los pedidos en tránsito pueden consultarse por número de pedido.",
  },
  {
    id: "return-policy",
    title: "Política de devoluciones",
    text: "Se aceptan devoluciones dentro de los 30 días de la entrega. Productos dañados: reportar dentro de los 7 días con fotos.",
  },
  {
    id: "payroll-private",
    title: "Nómina (privado)",
    text: "Empleado ficticio A: 1000. Empleado ficticio B: 1200. (Datos de juguete, sin PII real.)",
  },
];

/** Recursos que la política empresarial permite leer en modo protegido. */
export const ALLOWED_DOCUMENT_IDS: readonly string[] = ["shipping-policy", "return-policy"];

export function findDocument(id: string): InternalDocument | undefined {
  return DOCUMENTS.find((d) => d.id === id);
}
