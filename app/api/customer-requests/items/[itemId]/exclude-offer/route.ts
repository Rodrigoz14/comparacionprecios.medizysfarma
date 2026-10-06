import { prisma } from "@/lib/db/client";
import { getVerifiedSession } from "@/lib/auth/dal";
import { capAlternatives } from "@/lib/pricing/cap-alternatives";
import { isPricedPerContainer } from "@/lib/pricing/measured-forms";
import { calculateTotal, resolvePackagesNeeded, resolveUnitPrice } from "@/lib/pricing/price-calculator";
import type { OfferOption } from "@/lib/pricing/types";

/**
 * "Ninguna de estas ofertas": el usuario revisó las ofertas comparadas y
 * decide no comprarle a ninguna (p. ej. ningún precio le sirve, o va a
 * conseguirlo por otro medio). Deja todas las PriceComparison sin
 * seleccionar, así el ítem queda fuera del pedido a proveedores que se
 * descarga (Sección: bug real -- antes no había forma de excluir un
 * producto ya comparado sin perder el historial de la comparación).
 * Reversible: las alternativas se conservan, se puede volver a elegir
 * cualquiera con /select-offer.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const session = await getVerifiedSession();
  if (!session) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }

  const { itemId } = await params;
  const item = await prisma.customerRequestItem.findUnique({ where: { id: itemId } });
  if (!item) {
    return Response.json({ error: "El ítem de la solicitud no existe." }, { status: 404 });
  }

  const comparisons = await prisma.priceComparison.findMany({
    where: { customerRequestItemId: itemId },
    include: { supplier: true, product: { include: { laboratory: true } }, supplierOffer: true },
  });
  if (comparisons.length === 0) {
    return Response.json({ error: "Este ítem no tiene ninguna oferta comparada." }, { status: 400 });
  }

  await prisma.priceComparison.updateMany({ where: { customerRequestItemId: itemId }, data: { selected: false } });

  const toOption = (c: (typeof comparisons)[number]): OfferOption => {
    const packageSize = c.product.presentationQuantity;
    const perContainer = isPricedPerContainer(c.product.dosageForm, c.product.presentationUnit);
    const quantity = item.quantityToPurchase ?? item.requestedQuantity;
    // "Cantidad" es el número de empaques que pide el cliente, no unidades
    // sueltas -- ver el comentario en selection-engine.ts.
    const packagesNeeded = perContainer
      ? quantity
      : resolvePackagesNeeded(quantity, item.requestedPresentationQuantity, packageSize, c.product.presentationUnit);
    const packagePrice = Number(c.price);
    // Mismo criterio que selection-engine.ts (bug real confirmado
    // 2026-10-05, ver select-offer/route.ts): sin esto, una forma sellada
    // (Inyectable/Ampolla) medida en ml mostraba un "precio unitario" de
    // referencia dividido por el volumen de LA CAJA sellada, 24 veces menor
    // al real.
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

  const pricing = {
    customerRequestItemId: itemId,
    requestedQuantity: item.requestedQuantity,
    warehouseStock: item.warehouseStock,
    quantityToPurchase: item.quantityToPurchase,
    status: "EXCLUDED" as const,
    selected: null,
    alternatives: capAlternatives(comparisons.map(toOption), null),
    totalPrice: 0,
    savings: null,
    reason: "Excluido manualmente: no se incluirá en el pedido a proveedores.",
  };

  return Response.json({ itemId, pricing });
}
