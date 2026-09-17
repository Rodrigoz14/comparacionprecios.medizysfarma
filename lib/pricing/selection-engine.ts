import { prisma } from "@/lib/db/client";
import { checkAvailability } from "@/lib/pricing/availability";
import { capAlternatives } from "@/lib/pricing/cap-alternatives";
import { calculatePackagesNeededMeasured, calculateSavings, calculateTotal } from "@/lib/pricing/price-calculator";
import { isSealedUnitForm } from "@/lib/pricing/measured-forms";
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
    warehouseStock: null,
    quantityToPurchase: null,
    status,
    selected: null,
    alternatives: [],
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

  // Se descuenta lo que ya hay en bodega antes de cotizar (por genericKey,
  // igual que la selección de oferta: el laboratorio no importa). Si la
  // bodega ya cubre lo pedido, no tiene sentido comparar ni comprar nada.
  const stock = await prisma.warehouseStock.findUnique({ where: { genericKey: matchedProduct.genericKey } });
  const warehouseStock = stock?.quantity ?? 0;
  const quantityToPurchase = Math.max(0, item.requestedQuantity - warehouseStock);
  await prisma.customerRequestItem.update({
    where: { id: item.id },
    data: { warehouseStock, quantityToPurchase },
  });

  if (quantityToPurchase === 0) {
    await prisma.priceComparison.deleteMany({ where: { customerRequestItemId: item.id } });
    return {
      customerRequestItemId,
      requestedQuantity: item.requestedQuantity,
      warehouseStock,
      quantityToPurchase,
      status: "COVERED_BY_STOCK",
      selected: null,
      alternatives: [],
      totalPrice: 0,
      savings: null,
      reason: `Ya hay ${warehouseStock} unidades en bodega, suficientes para las ${item.requestedQuantity} solicitadas — no es necesario comprar ni cotizar.`,
    };
  }

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
    return {
      ...empty("NOT_FOUND", "No hay ninguna oferta de proveedor registrada para este producto."),
      warehouseStock,
      quantityToPurchase,
    };
  }

  const options: OfferOption[] = offers.map((offer) => {
    const packageSize = offer.product.presentationQuantity;
    const isSealedUnit = isSealedUnitForm(offer.product.dosageForm);
    // "Cantidad" es el número de empaques que pide el cliente del tamaño que
    // mencionó (caja, frasco...), nunca unidades sueltas dentro de ellos --
    // confirmado con el cliente (Medizys compra y factura por empaque
    // completo, no por tableta individual). Si esta oferta viene en un
    // tamaño distinto al que el cliente mencionó, se convierte por unidades
    // totales equivalentes (Sección: bug real del jarabe 30ml vs 15ml) --
    // aplica a cualquier forma, excepto ampollas/viales, que siempre son 1
    // unidad sellada = 1 empaque, sin conversión (el precio es por ampolla
    // individual, confirmado con el cliente, sin importar que el texto
    // mencione una caja de varias).
    const packagesNeeded = isSealedUnit
      ? quantityToPurchase
      : calculatePackagesNeededMeasured(quantityToPurchase, item.requestedPresentationQuantity, packageSize);
    const check = checkAvailability(offer.availability, offer.stockQuantity, packagesNeeded);
    // El precio que reporta el proveedor es por UNIDAD (tableta, cápsula,
    // ml/g...), nunca por el empaque completo -- confirmado con el cliente:
    // el precio de un empaque es unidades-por-empaque x precio unitario. Para
    // ampollas/viales el "empaque" ya es una sola unidad sellada, así que no
    // hay nada que multiplicar.
    const unitPrice = Number(offer.price);
    const packagePrice = isSealedUnit ? unitPrice : Math.round(unitPrice * packageSize * 100) / 100;
    return {
      supplierOfferId: offer.id,
      supplierId: offer.supplierId,
      supplierName: offer.supplier.name,
      productId: offer.productId,
      laboratoryName: offer.product.laboratory?.name ?? null,
      packageSize,
      presentationUnit: offer.product.presentationUnit,
      packagePrice,
      unitPrice,
      packagesNeeded,
      totalCost: calculateTotal(packagePrice, packagesNeeded),
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
      ...empty("NO_STOCK", "Ninguna oferta tiene disponibilidad suficiente para la cantidad que falta por comprar."),
      warehouseStock,
      quantityToPurchase,
      alternatives: options,
    };
  } else {
    const ranked = rankOffers(eligible, rules);
    const selected = ranked[0];
    const mostExpensive = Math.max(...eligible.map((o) => o.totalCost));
    const savings = calculateSavings(selected.totalCost, mostExpensive);

    result = {
      customerRequestItemId,
      requestedQuantity: item.requestedQuantity,
      warehouseStock,
      quantityToPurchase,
      status: "SELECTED",
      selected,
      alternatives: options,
      totalPrice: selected.totalCost,
      savings,
      reason:
        ranked.length === 1
          ? `Única oferta elegible: ${selected.supplierName}, ${selected.packagesNeeded} empaque(s) x${selected.packageSize} a $${selected.unitPrice} c/u = $${selected.totalCost}.`
          : `Menor costo total entre ${ranked.length} ofertas elegibles: ${selected.supplierName}, ${selected.packagesNeeded} empaque(s) x${selected.packageSize} a $${selected.unitPrice} c/u = $${selected.totalCost}.`,
    };
  }

  await persistComparison(item.id, Number(item.matchConfidence ?? 0), options, result.selected);

  return { ...result, alternatives: capAlternatives(result.alternatives, result.selected) };
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
      price: option.packagePrice,
      availability: option.availability,
      matchConfidence,
      selected: selected?.supplierOfferId === option.supplierOfferId,
      discardReason: option.discardReason,
    })),
  });
}
