import { prisma } from "@/lib/db/client";
import { checkAvailability } from "@/lib/pricing/availability";
import { capAlternatives } from "@/lib/pricing/cap-alternatives";
import { filterCurrentOffers } from "@/lib/pricing/current-offers";
import { formatCOP, formatUnitCOP } from "@/lib/pricing/format";
import { calculatePackagesNeededMeasured, calculateSavings, calculateTotal } from "@/lib/pricing/price-calculator";
import { isSafeExpirationLabel } from "@/lib/pricing/expiration";
import { isSealedUnitForm } from "@/lib/pricing/measured-forms";
import { DEFAULT_PRICING_RULES } from "@/lib/pricing/rules";
import { rankOffers } from "@/lib/pricing/supplier-ranking";
import { findSupplierProfile } from "@/lib/excel/supplier-profiles";
import type { OfferOption, PricingRules, SelectionResult } from "@/lib/pricing/types";

// Confirmado con el cliente (2026-09-22/23): un producto de Disfarma que no
// está marcado "SUPERIOR A 12 MESES" en FEC_VENC no se prefiere para
// comprar -- se pasa a la siguiente mejor alternativa (otro lote de
// Disfarma con vigencia segura, u otro proveedor). Si no hay ninguna otra
// oferta elegible, se usa igual la de Disfarma que vence pronto, en vez de
// dejar el producto sin comprar.
function hasSafeExpiration(option: OfferOption): boolean {
  const isDisfarma = findSupplierProfile(option.supplierName)?.key === "disfarma";
  if (!isDisfarma) return true;
  return isSafeExpirationLabel(option.expirationLabel);
}

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

  const allOffers = await prisma.supplierOffer.findMany({
    where: { productId: { in: productIds }, status: "ACTIVE" },
    include: { supplier: true, product: { include: { laboratory: true } } },
  });
  // Solo se cotiza contra el último archivo que subió cada proveedor -- una
  // oferta de un archivo viejo, reemplazada por uno más nuevo que ya no trae
  // ese producto, no debe recomendarse para comprar (Sección: vigencia por
  // último archivo, ver lib/pricing/current-offers.ts).
  const offers = await filterCurrentOffers(allOffers);

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
    // El precio que reporta el proveedor es por el EMPAQUE/presentación
    // completa, no por unidad suelta -- así está diseñado el importador
    // (lib/excel/detector.ts prioriza una columna "precio x presentación"
    // sobre "precio x unidad" al mapear el precio), y coincide con la
    // inmensa mayoría del catálogo real: cajas grandes (C*300 a C*1000)
    // traen precios de miles/cientos de miles de pesos que solo tienen
    // sentido como precio de la caja completa, nunca multiplicados de nuevo
    // por las unidades que trae -- se probó tratarlo como precio unitario y
    // multiplicarlo (bug real: una caja de 1000 Valsartán a $253.000 se
    // mostraba en $253.000.000). El precio unitario de referencia se deriva
    // al revés solo para mostrarlo, nunca al revés. Para ampollas/viales el
    // "empaque" ya es una sola unidad sellada, así que coincide con el
    // precio unitario sin necesidad de dividir.
    const packagePrice = Number(offer.price);
    // El precio unitario NUNCA se calcula cuando el proveedor ya lo reportó
    // tal cual en su archivo (confirmado con el cliente, 2026-09-22) -- se
    // usa ese valor exacto. Solo se deriva por división como respaldo, para
    // proveedores sin ese dato propio.
    const unitPrice =
      offer.unitPriceAsImported !== null
        ? Number(offer.unitPriceAsImported)
        : isSealedUnit
          ? packagePrice
          : Math.round((packagePrice / packageSize) * 10000) / 10000;
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
      expirationLabel: offer.expirationLabel,
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
    // Un Disfarma que vence pronto (o sin fecha confirmada) se deja de lado
    // mientras haya una alternativa más segura; si no la hay, se usa igual.
    const safePool = eligible.filter(hasSafeExpiration);
    const rankingPool = safePool.length > 0 ? safePool : eligible;

    const ranked = rankOffers(rankingPool, rules);
    const selected = ranked[0];
    const mostExpensive = Math.max(...rankingPool.map((o) => o.totalCost));
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
          ? `Única oferta elegible: ${selected.supplierName}, ${selected.packagesNeeded} empaque(s) x${selected.packageSize} a ${formatUnitCOP(selected.unitPrice)} c/u = ${formatCOP(selected.totalCost)}.`
          : `Menor costo total entre ${ranked.length} ofertas elegibles: ${selected.supplierName}, ${selected.packagesNeeded} empaque(s) x${selected.packageSize} a ${formatUnitCOP(selected.unitPrice)} c/u = ${formatCOP(selected.totalCost)}.`,
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
