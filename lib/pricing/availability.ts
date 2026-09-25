import type { Availability } from "@/lib/generated/prisma/client";

/**
 * Una oferta sin disponibilidad confirmada SÍ es elegible -- puede ganar por
 * precio igual que cualquier otra -- pero queda marcada con una advertencia
 * ("Disponibilidad desconocida...") para que quede claro que el proveedor no
 * reportó existencias, a diferencia de "Sin existencias" (confirmado que NO
 * hay) o "Existencia insuficiente" (confirmado que hay menos de lo pedido),
 * que sí siguen descartando la oferta. Confirmado con el cliente
 * (2026-09-25): antes "desconocida" se trataba igual que "sin existencias" y
 * dejaba fuera la opción más barata solo porque el proveedor no reportó ese
 * dato en el Excel.
 */
export function checkAvailability(
  availability: Availability,
  stockQuantity: number | null,
  requestedQuantity: number,
): { eligible: boolean; reason: string | null } {
  if (availability === "OUT_OF_STOCK") {
    return { eligible: false, reason: "Sin existencias." };
  }
  if (availability === "UNKNOWN") {
    return { eligible: true, reason: "Disponibilidad desconocida (no reportada por el proveedor)." };
  }
  if (stockQuantity !== null && stockQuantity < requestedQuantity) {
    return {
      eligible: false,
      reason: `Existencia insuficiente: ${stockQuantity} disponibles, se solicitan ${requestedQuantity}.`,
    };
  }
  return { eligible: true, reason: null };
}
