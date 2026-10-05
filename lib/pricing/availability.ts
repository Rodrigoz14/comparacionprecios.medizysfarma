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

/**
 * Texto para mostrarle al cliente en el Excel del pedido (columna
 * "Disponibilidad") -- a pedido del cliente (2026-10-05): cuando SÍ hay
 * disponibilidad confirmada debe indicarse textual Y numéricamente
 * ("Disponible: 150 unidades"), no solo un texto genérico. Una oferta
 * elegible (la única que puede llegar a quedar `selected` en una hoja de
 * proveedor) solo puede estar en uno de estos tres estados -- nunca "Sin
 * existencias" ni "Existencia insuficiente", porque esas ya se descartan
 * antes en `checkAvailability` (ver `selection-engine.ts`); se cubren aquí
 * solo por completitud.
 */
export function formatAvailabilityLabel(availability: Availability, stockQuantity: number | null): string {
  if (availability === "OUT_OF_STOCK") return "Sin existencias";
  if (availability === "UNKNOWN") return "Disponibilidad no confirmada";
  return stockQuantity !== null ? `Disponible: ${stockQuantity} unidades` : "Disponible";
}
