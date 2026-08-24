import { prisma } from "@/lib/db/client";
import { getVerifiedSession } from "@/lib/auth/dal";

/** Lista el inventario de bodega actual, con un producto representativo por cada genérico (para mostrarlo por nombre en vez de la clave interna). */
export async function GET() {
  if (!(await getVerifiedSession())) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }

  const stock = await prisma.warehouseStock.findMany({ orderBy: { updatedAt: "desc" } });
  if (stock.length === 0) {
    return Response.json({ items: [] });
  }

  const genericKeys = stock.map((s) => s.genericKey);
  const products = await prisma.product.findMany({
    where: { genericKey: { in: genericKeys } },
    distinct: ["genericKey"],
    select: {
      genericKey: true,
      standardName: true,
      activeIngredient: true,
      concentration: true,
      concentrationUnit: true,
      dosageForm: true,
    },
  });
  const productByKey = new Map(products.map((p) => [p.genericKey, p]));

  const items = stock.map((s) => {
    const product = productByKey.get(s.genericKey);
    return {
      genericKey: s.genericKey,
      quantity: s.quantity,
      updatedAt: s.updatedAt,
      productName: product
        ? `${product.activeIngredient} ${product.concentration}${product.concentrationUnit} — ${product.dosageForm}`
        : s.genericKey,
    };
  });

  return Response.json({ items });
}
