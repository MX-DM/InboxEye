// Pedidos 100% sintéticos de NovaShop. Ningún dato real.
export interface Order {
  id: string;
  status: "IN_TRANSIT" | "DELIVERED" | "PROCESSING";
  estimatedDelivery: string;
  carrier: string;
}

export const ORDERS: Order[] = [
  { id: "ORD-1001", status: "IN_TRANSIT", estimatedDelivery: "2026-10-26", carrier: "NovaShip" },
  { id: "ORD-1002", status: "DELIVERED", estimatedDelivery: "2026-10-18", carrier: "NovaShip" },
];

export function findOrder(id: string): Order | undefined {
  return ORDERS.find((o) => o.id === id);
}
