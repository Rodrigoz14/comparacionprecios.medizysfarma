import { z } from "zod";
import { confirmSupplierImport } from "@/lib/excel/importer";
import { getVerifiedSession } from "@/lib/auth/dal";

const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024; // 30 MB

const metadataSchema = z.object({
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

// El archivo se reenvía completo aquí (no solo un token que apunte a algo
// guardado por el servidor entre peticiones): en un entorno serverless
// (Vercel) no hay garantía de que "analizar" y "confirmar" caigan en la
// misma instancia con el mismo disco -- bug real reportado por el cliente,
// donde el archivo temporal "ya no existía" al confirmar. El cliente
// (ImportWizard.tsx) ya tiene el archivo completo en memoria desde que el
// usuario lo seleccionó, así que reenviarlo es la forma confiable.
export async function POST(request: Request) {
  if (!(await getVerifiedSession())) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const metadataRaw = formData.get("metadata");

  if (!(file instanceof File)) {
    return Response.json({ error: "Falta el archivo." }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return Response.json({ error: "El archivo supera el límite de 30 MB." }, { status: 400 });
  }
  if (typeof metadataRaw !== "string") {
    return Response.json({ error: "Faltan los datos de importación." }, { status: 400 });
  }

  let metadataJson: unknown;
  try {
    metadataJson = JSON.parse(metadataRaw);
  } catch {
    return Response.json({ error: "Datos de importación inválidos." }, { status: 400 });
  }

  const parsed = metadataSchema.safeParse(metadataJson);
  if (!parsed.success) {
    return Response.json({ error: "Datos de importación inválidos.", details: parsed.error.issues }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const report = await confirmSupplierImport({ ...parsed.data, buffer, originalName: file.name });
    return Response.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo completar la importación.";
    return Response.json({ error: message }, { status: 400 });
  }
}
