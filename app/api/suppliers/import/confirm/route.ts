import { z } from "zod";
import { confirmSupplierImport } from "@/lib/excel/importer";
import { getVerifiedSession } from "@/lib/auth/dal";

const bodySchema = z.object({
  fileToken: z.string().min(1),
  supplierId: z.string().min(1),
  sheetName: z.string().min(1),
  headerRowIndex: z.number().int().min(0),
  mapping: z.record(z.string(), z.number().int().min(0)),
  priceFormat: z.object({
    thousands: z.enum([".", ",", "none"]),
    decimal: z.enum([".", ","]),
  }),
  force: z.boolean().optional(),
});

export async function POST(request: Request) {
  if (!(await getVerifiedSession())) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Datos de importación inválidos.", details: parsed.error.issues }, { status: 400 });
  }

  try {
    const report = await confirmSupplierImport(parsed.data);
    return Response.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo completar la importación.";
    return Response.json({ error: message }, { status: 400 });
  }
}
