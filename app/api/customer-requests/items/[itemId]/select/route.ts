import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { selectBestOffer } from "@/lib/pricing/selection-engine";
import { getVerifiedSession } from "@/lib/auth/dal";

const bodySchema = z.object({
  productId: z.string().min(1),
});

/**
 * Confirma manualmente a qué producto corresponde un ítem que quedó en REVIEW
 * (p. ej. varias formas farmacéuticas disponibles, o coincidencia aproximada
 * por typo): el usuario elige entre los candidatos que ya mostró la
 * homologación, nunca se adivina. Tras confirmar, se vuelve a correr el motor
 * de precios para ese ítem.
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
    return Response.json({ error: "Falta el producto elegido." }, { status: 400 });
  }

  const item = await prisma.customerRequestItem.findUnique({ where: { id: itemId } });
  if (!item) {
    return Response.json({ error: "El ítem de la solicitud no existe." }, { status: 404 });
  }

  const product = await prisma.product.findUnique({ where: { id: parsed.data.productId } });
  if (!product) {
    return Response.json({ error: "El producto elegido no existe." }, { status: 404 });
  }

  await prisma.customerRequestItem.update({
    where: { id: itemId },
    data: { matchStatus: "MATCH", matchConfidence: 1, matchedProductId: product.id },
  });

  const pricing = await selectBestOffer(itemId);
  const match = {
    decision: "MATCH" as const,
    confidence: 1,
    matchedProductIds: [product.id],
    candidates: [],
    reasons: [`Confirmado manualmente: ${product.standardName}.`],
    source: "manual" as const,
  };

  return Response.json({ itemId, match, pricing });
}
