import type { OfferOption, PricingRules } from "@/lib/pricing/types";

/**
 * Ordena las ofertas elegibles por lo que realmente cuesta cubrir el pedido
 * (totalCost = empaques completos necesarios × precio del empaque), no por
 * precio unitario: dos presentaciones distintas del mismo medicamento pueden
 * quedar empatadas en precio unitario pero costar distinto una vez se redondea
 * a empaques completos, así que totalCost es el único criterio correcto de
 * selección (a pedido del cliente: comparar por unidad, no por presentación).
 * Si hay un proveedor preferido configurado y su costo total está dentro del
 * margen de tolerancia frente al más barato, gana el proveedor preferido
 * (Sección 6.22-6.23).
 */
export function rankOffers(eligible: OfferOption[], rules: PricingRules): OfferOption[] {
  const sorted = [...eligible].sort((a, b) => a.totalCost - b.totalCost);
  if (sorted.length === 0 || !rules.preferredSupplierId) return sorted;

  const cheapest = sorted[0];
  const preferred = sorted.find((o) => o.supplierId === rules.preferredSupplierId);
  if (!preferred || preferred === cheapest) return sorted;

  const difference = (preferred.totalCost - cheapest.totalCost) / cheapest.totalCost;
  if (difference <= rules.preferredSupplierTolerance) {
    return [preferred, ...sorted.filter((o) => o !== preferred)];
  }
  return sorted;
}
