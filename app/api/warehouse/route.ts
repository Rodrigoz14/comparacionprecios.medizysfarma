import { prisma } from "@/lib/db/client";
import { getVerifiedSession } from "@/lib/auth/dal";

/** Lista el inventario de bodega actual, tal cual se guardó (sin depender del catálogo de Proveedores). */
export async function GET() {
  if (!(await getVerifiedSession())) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }

  const stock = await prisma.warehouseStock.findMany({ orderBy: { updatedAt: "desc" } });

  const items = stock.map((s) => ({
    genericKey: s.genericKey,
    quantity: s.quantity,
    updatedAt: s.updatedAt,
    productName: s.rawProductName ?? s.genericKey,
  }));

  return Response.json({ items });
}
