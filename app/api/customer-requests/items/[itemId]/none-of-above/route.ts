import { prisma } from "@/lib/db/client";
import { getVerifiedSession } from "@/lib/auth/dal";

const NOTE = "El usuario confirmó que ninguna de las opciones sugeridas corresponde; requiere búsqueda manual.";

/**
 * El usuario revisó las opciones que la homologación le mostró (por
 * ambigüedad de forma farmacéutica, typo, etc.) y ninguna es el producto que
 * busca. Se marca así en vez de forzarlo a elegir la menos mala: queda
 * NO_MATCH con una nota explícita, para que quien revise después sepa que ya
 * se descartaron esas opciones a propósito, no que la búsqueda simplemente
 * no encontró nada.
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

  await prisma.customerRequestItem.update({
    where: { id: itemId },
    data: { matchStatus: "NO_MATCH", matchConfidence: 0, matchedProductId: null, notes: NOTE },
  });
  await prisma.priceComparison.deleteMany({ where: { customerRequestItemId: itemId } });

  const match = {
    decision: "NO_MATCH" as const,
    confidence: 0,
    matchedProductIds: [],
    candidates: [],
    reasons: [NOTE],
    source: "manual" as const,
  };
  const pricing = {
    customerRequestItemId: itemId,
    requestedQuantity: item.requestedQuantity,
    warehouseStock: null,
    quantityToPurchase: null,
    status: "NOT_FOUND" as const,
    selected: null,
    alternatives: [],
    totalPrice: null,
    savings: null,
    reason: NOTE,
  };

  return Response.json({ itemId, match, pricing });
}
