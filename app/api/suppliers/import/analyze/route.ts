import { analyzeSupplierFile } from "@/lib/excel/importer";
import { getVerifiedSession } from "@/lib/auth/dal";

const MAX_FILE_SIZE_BYTES = 30 * 1024 * 1024; // 30 MB
const ALLOWED_EXTENSIONS = [".xlsx", ".xlsm", ".csv"];

export async function POST(request: Request) {
  if (!(await getVerifiedSession())) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const supplierId = formData.get("supplierId");

  if (!(file instanceof File)) {
    return Response.json({ error: "Falta el archivo." }, { status: 400 });
  }
  if (typeof supplierId !== "string" || !supplierId) {
    return Response.json({ error: "Falta el proveedor." }, { status: 400 });
  }

  const lowerName = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
    return Response.json(
      { error: "Formato no soportado. Solo se aceptan archivos .xlsx, .xlsm o .csv." },
      { status: 400 },
    );
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return Response.json({ error: "El archivo supera el límite de 30 MB." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const result = await analyzeSupplierFile(buffer, file.name, supplierId);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo analizar el archivo.";
    return Response.json({ error: message }, { status: 400 });
  }
}
