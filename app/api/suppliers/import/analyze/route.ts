import { analyzeSupplierFile } from "@/lib/excel/importer";
import { getVerifiedSession } from "@/lib/auth/dal";

const ALLOWED_EXTENSIONS = [".xlsx", ".xlsm", ".csv"];

// El archivo ya no llega en el cuerpo de esta petición: el navegador lo sube
// primero directo a Vercel Blob (ver /api/blob-upload), y aquí solo se
// recibe la URL -- así el tamaño real del archivo nunca choca con el
// límite de 4.5 MB que Vercel impone al cuerpo de una función serverless.
export async function POST(request: Request) {
  if (!(await getVerifiedSession())) {
    return Response.json({ error: "No autenticado." }, { status: 401 });
  }

  const body = await request.json();
  const { blobUrl, originalName, supplierId } = body as {
    blobUrl?: unknown;
    originalName?: unknown;
    supplierId?: unknown;
  };

  if (typeof blobUrl !== "string" || !blobUrl) {
    return Response.json({ error: "Falta el archivo." }, { status: 400 });
  }
  if (typeof originalName !== "string" || !originalName) {
    return Response.json({ error: "Falta el nombre del archivo." }, { status: 400 });
  }
  if (typeof supplierId !== "string" || !supplierId) {
    return Response.json({ error: "Falta el proveedor." }, { status: 400 });
  }

  const lowerName = originalName.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
    return Response.json(
      { error: "Formato no soportado. Solo se aceptan archivos .xlsx, .xlsm o .csv." },
      { status: 400 },
    );
  }

  let buffer: Buffer;
  try {
    const fileRes = await fetch(blobUrl);
    if (!fileRes.ok) throw new Error(`status ${fileRes.status}`);
    buffer = Buffer.from(await fileRes.arrayBuffer());
  } catch {
    return Response.json({ error: "No se pudo leer el archivo subido. Vuelve a intentarlo." }, { status: 400 });
  }

  try {
    const result = await analyzeSupplierFile(buffer, originalName, supplierId);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo analizar el archivo.";
    return Response.json({ error: message }, { status: 400 });
  }
}
