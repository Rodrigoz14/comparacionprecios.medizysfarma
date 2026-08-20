import type { PricingRules } from "@/lib/pricing/types";

/**
 * Regla MVP (Sección 6.15): exigir disponibilidad, exigir presentación exacta
 * (ya garantizado porque solo se comparan ofertas del mismo `genericKey`), y
 * ganar por menor precio. Proveedor preferido y compra dividida quedan
 * desactivados por defecto (Sección 6.21).
 */
export const DEFAULT_PRICING_RULES: PricingRules = {
  preferredSupplierId: null,
  preferredSupplierTolerance: 0.02,
};
