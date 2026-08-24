import { getVerifiedSession } from "@/lib/auth/dal";
import { buildPurchaseOrderWorkbook } from "@/lib/pricing/purchase-order-export";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getVerifiedSession())) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }

  const { id } = await params;
  const result = await buildPurchaseOrderWorkbook(id);
  if (!result) {
    return Response.json(
      { error: "No hay productos para comprar en esta solicitud (todo cubierto por bodega o sin ofertas seleccionadas)." },
      { status: 400 },
    );
  }

  return new Response(new Uint8Array(result.buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${result.fileName}"`,
    },
  });
}
