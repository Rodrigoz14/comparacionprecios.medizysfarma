import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { resolveCustomerRequestItem } from "@/lib/matching/matching-service";
import { selectBestOffer } from "@/lib/pricing/selection-engine";
import { getVerifiedSession } from "@/lib/auth/dal";

const bodySchema = z.object({
  customerName: z.string().min(1),
  items: z
    .array(
      z.object({
        text: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
});

export async function POST(request: Request) {
  const session = await getVerifiedSession();
  if (!session) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Datos de solicitud inválidos." }, { status: 400 });
  }

  const customerRequest = await prisma.customerRequest.create({
    data: { customerName: parsed.data.customerName, status: "ANALYZING", responsibleUserId: session.userId },
  });

  const results = [];
  for (const line of parsed.data.items) {
    const item = await prisma.customerRequestItem.create({
      data: {
        customerRequestId: customerRequest.id,
        originalText: line.text,
        requestedQuantity: line.quantity,
      },
    });

    const match = await resolveCustomerRequestItem(item.id);
    const pricing = await selectBestOffer(item.id);

    results.push({ itemId: item.id, originalText: line.text, requestedQuantity: line.quantity, match, pricing });
  }

  await prisma.customerRequest.update({
    where: { id: customerRequest.id },
    data: { status: "READY" },
  });

  return Response.json({ customerRequestId: customerRequest.id, items: results });
}
