import { z } from "zod";
import { mapWithConcurrency } from "@/lib/concurrency";
import { prisma } from "@/lib/db/client";
import { resolveCustomerRequestItem } from "@/lib/matching/matching-service";
import { selectBestOffer } from "@/lib/pricing/selection-engine";
import { getVerifiedSession } from "@/lib/auth/dal";
import { SECTOR_VALUES } from "@/lib/sectors";

// Homologar y cotizar cada producto implica varias consultas reales a la
// base de datos (y a veces una llamada a la IA); un pedido grande puede
// tardar más que el límite de tiempo por defecto de la función.
export const maxDuration = 300;

const bodySchema = z.object({
  customerName: z.string().min(1),
  // Rubro de TODA la solicitud (confirmado con el cliente, 2026-09-28): una
  // sola vez por solicitud, no por fila -- acota la búsqueda de cada ítem a
  // ese sector, más rápida y sin candidatos de un rubro que no aplica.
  sector: z.enum(SECTOR_VALUES),
  items: z
    .array(
      z.object({
        text: z.string().min(1),
        quantity: z.number().int().positive(),
        // Cliente puntual de esta fila, cuando el Excel subido traía varios
        // clientes mezclados en un mismo archivo (columna de cliente
        // detectada automáticamente). Null si esa fila es del "customerName"
        // general elegido en el formulario.
        clientName: z.string().min(1).nullish(),
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
    data: {
      customerName: parsed.data.customerName,
      sector: parsed.data.sector,
      status: "ANALYZING",
      responsibleUserId: session.userId,
    },
  });

  const results = await mapWithConcurrency(parsed.data.items, 8, async (line) => {
    const item = await prisma.customerRequestItem.create({
      data: {
        customerRequestId: customerRequest.id,
        originalText: line.text,
        requestedQuantity: line.quantity,
        clientName: line.clientName ?? null,
      },
    });

    const match = await resolveCustomerRequestItem(item.id, parsed.data.sector);
    const pricing = await selectBestOffer(item.id);

    return {
      itemId: item.id,
      originalText: line.text,
      requestedQuantity: line.quantity,
      clientName: line.clientName ?? null,
      match,
      pricing,
    };
  });

  await prisma.customerRequest.update({
    where: { id: customerRequest.id },
    data: { status: "READY" },
  });

  return Response.json({ customerRequestId: customerRequest.id, items: results });
}
