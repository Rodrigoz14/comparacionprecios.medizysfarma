import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getVerifiedSession } from "@/lib/auth/dal";

const ALLOWED_CONTENT_TYPES = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel.sheet.macroEnabled.12", // .xlsm
  "application/vnd.ms-excel",
  "text/csv",
  "application/octet-stream",
];

/**
 * Genera el token que le permite al navegador subir el archivo DIRECTO a
 * Vercel Blob, sin pasar por el cuerpo de una función serverless (que en
 * Vercel tiene un límite de 4.5 MB, insuficiente para una lista real de
 * precios de un proveedor con miles de filas) -- bug real reportado por el
 * cliente al confirmar una importación de Disfarma.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        const session = await getVerifiedSession();
        if (!session) {
          throw new Error("No autenticado.");
        }
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: 30 * 1024 * 1024, // 30 MB
        };
      },
      onUploadCompleted: async () => {
        // No se necesita ninguna acción aquí: el cliente recibe la URL del
        // blob directamente en la respuesta de upload() y la usa para
        // llamar a analizar/confirmar. No depende de este webhook (que
        // ademas no es alcanzable en desarrollo local, sin URL pública).
      },
    });

    return Response.json(jsonResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo generar el token de carga.";
    return Response.json({ error: message }, { status: 400 });
  }
}
