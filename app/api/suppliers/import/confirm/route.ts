import { z } from "zod";
import { confirmSupplierImport } from "@/lib/excel/importer";
import { getVerifiedSession } from "@/lib/auth/dal";

// Confirmar la importación de un archivo grande (miles de filas) puede
// tardar más que el límite por defecto (10s).
export const maxDuration = 300;

const bodySchema = z.object({
  blobUrl: z.string().min(1),
  originalName: z.string().min(1),
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

// Se reutiliza la misma URL de Vercel Blob que ya generó /api/suppliers/import/analyze
// -- el archivo no se vuelve a subir, así que el cuerpo de esta petición es
// pequeño (solo metadatos) sin importar el tamaño real del archivo.
export async function POST(request: Request) {
  if (!(await getVerifiedSession())) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Datos de importación inválidos.", details: parsed.error.issues }, { status: 400 });
  }

  let buffer: Buffer;
  try {
    const fileRes = await fetch(parsed.data.blobUrl);
    if (!fileRes.ok) throw new Error(`status ${fileRes.status}`);
    buffer = Buffer.from(await fileRes.arrayBuffer());
  } catch {
    return Response.json({ error: "No se pudo leer el archivo subido. Vuelve a intentarlo." }, { status: 400 });
  }

  try {
    const report = await confirmSupplierImport({
      buffer,
      originalName: parsed.data.originalName,
      storagePath: parsed.data.blobUrl,
      supplierId: parsed.data.supplierId,
      sheetName: parsed.data.sheetName,
      headerRowIndex: parsed.data.headerRowIndex,
      mapping: parsed.data.mapping,
      priceFormat: parsed.data.priceFormat,
      force: parsed.data.force,
    });
    return Response.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo completar la importación.";
    return Response.json({ error: message }, { status: 400 });
  }
}
