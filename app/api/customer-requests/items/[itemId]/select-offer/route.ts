import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getVerifiedSession } from "@/lib/auth/dal";
import { capAlternatives } from "@/lib/pricing/cap-alternatives";
import { formatCOP, formatUnitCOP } from "@/lib/pricing/format";
import { isPricedPerContainer } from "@/lib/pricing/measured-forms";
import { calculateSavings, calculateTotal, resolvePackagesNeeded, resolveUnitPrice } from "@/lib/pricing/price-calculator";
import type { OfferOption } from "@/lib/pricing/types";

const bodySchema = z.object({ supplierOfferId: z.string().min(1) });

/**
 * Deja que el usuario elija manualmente cuál de las ofertas ya comparadas
 * usar, en vez de la que el motor de precios seleccionó automáticamente
 * (p. ej. prefiere un proveedor específico, o confirmó disponibilidad real
 * que el dato importado no reflejaba). No vuelve a comparar nada: solo
 * cambia cuál PriceComparison queda marcada `selected`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const session = await getVerifiedSession();
  if (!session) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }

  const { itemId } = await params;
  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Falta la oferta elegida." }, { status: 400 });
  }

  const item = await prisma.customerRequestItem.findUnique({ where: { id: itemId } });
  if (!item) {
    return Response.json({ error: "El ítem de la solicitud no existe." }, { status: 404 });
  }
  if (item.quantityToPurchase === null || item.quantityToPurchase === 0) {
    return Response.json({ error: "Este ítem no tiene nada pendiente de comprar." }, { status: 400 });
  }

  const comparisons = await prisma.priceComparison.findMany({
    where: { customerRequestItemId: itemId },
    include: { supplier: true, product: { include: { laboratory: true } }, supplierOffer: true },
  });
  const target = comparisons.find((c) => c.supplierOfferId === parsed.data.supplierOfferId);
  if (!target) {
    return Response.json({ error: "La oferta elegida no está entre las comparadas para este ítem." }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.priceComparison.updateMany({ where: { customerRequestItemId: itemId }, data: { selected: false } }),
    prisma.priceComparison.update({ where: { id: target.id }, data: { selected: true } }),
  ]);

  const toOption = (c: (typeof comparisons)[number]): OfferOption => {
    const packageSize = c.product.presentationQuantity;
    const perContainer = isPricedPerContainer(c.product.dosageForm, c.product.presentationUnit);
    // "Cantidad" es el número de empaques que pide el cliente, no unidades
    // sueltas -- ver el comentario en selection-engine.ts.
    const packagesNeeded = perContainer
      ? item!.quantityToPurchase!
      : resolvePackagesNeeded(item!.quantityToPurchase!, item!.requestedPresentationQuantity, packageSize, c.product.presentationUnit);
    const packagePrice = Number(c.price);
    // Mismo criterio que selection-engine.ts (bug real confirmado
    // 2026-10-05): esta ruta reconstruye la oferta a partir de
    // PriceComparison por separado, y había quedado sin este mismo ajuste --
    // dividía SIEMPRE packagePrice entre packageSize, incluso para una forma
    // sellada (Inyectable/Ampolla) medida en ml ("24ML" es el volumen de LA
    // CAJA sellada, no una cantidad a fraccionar). El total mostrado seguía
    // siendo correcto (se calcula aparte, directo de packagePrice), pero el
    // "precio unitario" de referencia mostraba una cifra 24 veces menor a la
    // real, dando la impresión de que el precio se había "multiplicado por
    // los ml" al no cuadrar con el total.
    const unitPriceAsImported = c.supplierOffer.unitPriceAsImported;
    const unitPrice = resolveUnitPrice(
      packagePrice,
      packageSize,
      perContainer,
      unitPriceAsImported !== null ? Number(unitPriceAsImported) : null,
    );
    return {
      supplierOfferId: c.supplierOfferId,
      supplierId: c.supplierId,
      supplierName: c.supplier.name,
      productId: c.productId,
      laboratoryName: c.product.laboratory?.name ?? null,
      packageSize,
      presentationUnit: c.product.presentationUnit,
      packagePrice,
      unitPrice,
      packagesNeeded,
      totalCost: calculateTotal(packagePrice, packagesNeeded),
      availability: c.availability,
      stockQuantity: null,
      // PriceComparison no guarda la vigencia (solo se usa al comparar por
      // primera vez, en selectBestOffer) -- reconstruir esta lista para
      // mostrarla de nuevo no necesita volver a evaluarla.
      expirationLabel: null,
      // "Disponibilidad desconocida" ya no descarta la oferta (ver
      // lib/pricing/availability.ts) -- discardReason puede venir lleno en
      // una oferta igualmente elegible, así que la elegibilidad se deriva de
      // `availability` (lo único que sí distingue "sin existencias" de las
      // demás en este historial, que no guarda stockQuantity).
      eligible: c.availability !== "OUT_OF_STOCK",
      discardReason: c.discardReason,
    };
  };

  const alternatives = comparisons.map(toOption);
  const selected = alternatives.find((a) => a.supplierOfferId === parsed.data.supplierOfferId)!;
  const eligibleTotals = alternatives.filter((a) => a.eligible).map((a) => a.totalCost);
  const mostExpensive = eligibleTotals.length > 0 ? Math.max(...eligibleTotals) : selected.totalCost;
  const savings = calculateSavings(selected.totalCost, mostExpensive);

  const pricing = {
    customerRequestItemId: itemId,
    requestedQuantity: item.requestedQuantity,
    warehouseStock: item.warehouseStock,
    quantityToPurchase: item.quantityToPurchase,
    status: "SELECTED" as const,
    selected,
    alternatives: capAlternatives(alternatives, selected),
    totalPrice: selected.totalCost,
    savings,
    reason: `Selección manual: ${selected.supplierName}, ${selected.packagesNeeded} empaque(s) x${selected.packageSize} ${selected.presentationUnit} a ${formatUnitCOP(selected.unitPrice)} c/u = ${formatCOP(selected.totalCost)}.`,
  };

  return Response.json({ itemId, pricing });
}
