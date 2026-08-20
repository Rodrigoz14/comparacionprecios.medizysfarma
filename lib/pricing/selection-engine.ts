import { prisma } from "@/lib/db/client";
import { checkAvailability } from "@/lib/pricing/availability";
import { calculateSavings, calculateTotal } from "@/lib/pricing/price-calculator";
import { DEFAULT_PRICING_RULES } from "@/lib/pricing/rules";
import { rankOffers } from "@/lib/pricing/supplier-ranking";
import type { OfferOption, PricingRules, SelectionResult } from "@/lib/pricing/types";

/**
 * Selecciona la mejor oferta para un ítem de solicitud ya homologado (Sección 5).
 * Agrupa por `genericKey` (mismo genérico, cualquier laboratorio) porque el
 * laboratorio no es criterio de selección para Medizys — solo precio y
 * disponibilidad. Guarda todas las alternativas consideradas, no solo la
 * ganadora, para poder auditar la decisión (Sección 6.17).
 */
export async function selectBestOffer(
  customerRequestItemId: string,
  rules: PricingRules = DEFAULT_PRICING_RULES,
): Promise<SelectionResult> {
  const item = await prisma.customerRequestItem.findUniqueOrThrow({
    where: { id: customerRequestItemId },
  });

  const empty = (status: SelectionResult["status"], reason: string): SelectionResult => ({
    customerRequestItemId,
    requestedQuantity: item.requestedQuantity,
    status,
    selected: null,
    alternatives: [],
    unitPrice: null,
    totalPrice: null,
    savings: null,
    reason,
  });

  if (item.matchStatus === "NO_MATCH") {
    return empty("NOT_FOUND", "Producto no encontrado en el catálogo.");
  }
  if (item.matchStatus !== "MATCH" || !item.matchedProductId) {
    return empty("REVIEW", "El producto requiere revisión de homologación antes de poder cotizarse.");
  }

  const matchedProduct = await prisma.product.findUniqueOrThrow({ where: { id: item.matchedProductId } });

  const genericFamily = await prisma.product.findMany({
    where: { genericKey: matchedProduct.genericKey, status: "ACTIVE" },
    select: { id: true },
  });
  const productIds = genericFamily.map((p) => p.id);

  const offers = await prisma.supplierOffer.findMany({
    where: { productId: { in: productIds }, status: "ACTIVE" },
    include: { supplier: true, product: { include: { laboratory: true } } },
  });

  if (offers.length === 0) {
    return empty("NOT_FOUND", "No hay ninguna oferta de proveedor registrada para este producto.");
  }

  const options: OfferOption[] = offers.map((offer) => {
    const check = checkAvailability(offer.availability, offer.stockQuantity, item.requestedQuantity);
    return {
      supplierOfferId: offer.id,
      supplierId: offer.supplierId,
      supplierName: offer.supplier.name,
      productId: offer.productId,
      laboratoryName: offer.product.laboratory?.name ?? null,
      unitPrice: Number(offer.price),
      availability: offer.availability,
      stockQuantity: offer.stockQuantity,
      eligible: check.eligible,
      discardReason: check.reason,
    };
  });

  const eligible = options.filter((o) => o.eligible);

  let result: SelectionResult;

  if (eligible.length === 0) {
    result = {
      ...empty("NO_STOCK", "Ninguna oferta tiene disponibilidad suficiente para la cantidad solicitada."),
      alternatives: options,
    };
  } else {
    const ranked = rankOffers(eligible, rules);
    const selected = ranked[0];
    const mostExpensive = Math.max(...eligible.map((o) => o.unitPrice));
    const totalPrice = calculateTotal(selected.unitPrice, item.requestedQuantity);
    const savings = calculateSavings(selected.unitPrice, mostExpensive, item.requestedQuantity);

    result = {
      customerRequestItemId,
      requestedQuantity: item.requestedQuantity,
      status: "SELECTED",
      selected,
      alternatives: options,
      unitPrice: selected.unitPrice,
      totalPrice,
      savings,
      reason:
        ranked.length === 1
          ? `Única oferta elegible: ${selected.supplierName} a $${selected.unitPrice}.`
          : `Menor precio entre ${ranked.length} ofertas elegibles: ${selected.supplierName} a $${selected.unitPrice}.`,
    };
  }

  await persistComparison(item.id, Number(item.matchConfidence ?? 0), options, result.selected);

  return result;
}

async function persistComparison(
  customerRequestItemId: string,
  matchConfidence: number,
  options: OfferOption[],
  selected: OfferOption | null,
) {
  await prisma.priceComparison.deleteMany({ where: { customerRequestItemId } });
  if (options.length === 0) return;

  await prisma.priceComparison.createMany({
    data: options.map((option) => ({
      customerRequestItemId,
      productId: option.productId,
      supplierId: option.supplierId,
      supplierOfferId: option.supplierOfferId,
      price: option.unitPrice,
      availability: option.availability,
      matchConfidence,
      selected: selected?.supplierOfferId === option.supplierOfferId,
      discardReason: option.discardReason,
    })),
  });
}
