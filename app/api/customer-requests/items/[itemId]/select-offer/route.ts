import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getVerifiedSession } from "@/lib/auth/dal";
import { isSealedUnitForm } from "@/lib/pricing/measured-forms";
import { calculatePackagesNeededMeasured, calculateSavings, calculateTotal } from "@/lib/pricing/price-calculator";
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
    include: { supplier: true, product: { include: { laboratory: true } } },
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
    const isSealedUnit = isSealedUnitForm(c.product.dosageForm);
    // "Cantidad" es el número de empaques que pide el cliente, no unidades
    // sueltas -- ver el comentario en selection-engine.ts.
    const packagesNeeded = isSealedUnit
      ? item!.quantityToPurchase!
      : calculatePackagesNeededMeasured(item!.quantityToPurchase!, item!.requestedPresentationQuantity, packageSize);
    const packagePrice = Number(c.price);
    return {
      supplierOfferId: c.supplierOfferId,
      supplierId: c.supplierId,
      supplierName: c.supplier.name,
      productId: c.productId,
      laboratoryName: c.product.laboratory?.name ?? null,
      packageSize,
      presentationUnit: c.product.presentationUnit,
      packagePrice,
      unitPrice: Math.round((packagePrice / packageSize) * 10000) / 10000,
      packagesNeeded,
      totalCost: calculateTotal(packagePrice, packagesNeeded),
      availability: c.availability,
      stockQuantity: null,
      eligible: c.discardReason === null,
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
    alternatives,
    totalPrice: selected.totalCost,
    savings,
    reason: `Selección manual: ${selected.supplierName}, ${selected.packagesNeeded} empaque(s) x${selected.packageSize} ${selected.presentationUnit} a $${selected.unitPrice} c/u = $${selected.totalCost}.`,
  };

  return Response.json({ itemId, pricing });
}
