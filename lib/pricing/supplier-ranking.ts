import type { OfferOption, PricingRules } from "@/lib/pricing/types";

/**
 * Ordena las ofertas elegibles por precio (menor primero). Si hay un proveedor
 * preferido configurado y su precio está dentro del margen de tolerancia
 * frente al más barato, gana el proveedor preferido (Sección 6.22-6.23).
 */
export function rankOffers(eligible: OfferOption[], rules: PricingRules): OfferOption[] {
  const sorted = [...eligible].sort((a, b) => a.unitPrice - b.unitPrice);
  if (sorted.length === 0 || !rules.preferredSupplierId) return sorted;

  const cheapest = sorted[0];
  const preferred = sorted.find((o) => o.supplierId === rules.preferredSupplierId);
  if (!preferred || preferred === cheapest) return sorted;

  const difference = (preferred.unitPrice - cheapest.unitPrice) / cheapest.unitPrice;
  if (difference <= rules.preferredSupplierTolerance) {
    return [preferred, ...sorted.filter((o) => o !== preferred)];
  }
  return sorted;
}
