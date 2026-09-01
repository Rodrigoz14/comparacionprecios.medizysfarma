import { getVerifiedSession } from "@/lib/auth/dal";
import { importWarehouseStock } from "@/lib/warehouse/importer";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".xlsx", ".xlsm", ".csv"];

// Homologar cada fila contra el catálogo implica al menos una consulta real
// a la base de datos por fila, en serie -- un inventario de varios cientos
// o miles de productos puede superar fácilmente el límite de tiempo por
// defecto de la función.
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!(await getVerifiedSession())) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Falta el archivo." }, { status: 400 });
  }

  const lowerName = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
    return Response.json(
      { error: "Formato no soportado. Solo se aceptan archivos .xlsx, .xlsm o .csv." },
      { status: 400 },
    );
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return Response.json({ error: "El archivo supera el límite de 10 MB." }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const report = await importWarehouseStock(buffer, file.name);
    return Response.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo importar el inventario.";
    return Response.json({ error: message }, { status: 400 });
  }
}
