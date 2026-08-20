import type { Availability } from "@/lib/generated/prisma/client";

/**
 * Nunca asume disponibilidad: una oferta sin disponibilidad confirmada no es
 * elegible, aunque tenga el mejor precio (Sección 6.8).
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
    return { eligible: false, reason: "Disponibilidad desconocida (no reportada por el proveedor)." };
  }
  if (stockQuantity !== null && stockQuantity < requestedQuantity) {
    return {
      eligible: false,
      reason: `Existencia insuficiente: ${stockQuantity} disponibles, se solicitan ${requestedQuantity}.`,
    };
  }
  return { eligible: true, reason: null };
}
