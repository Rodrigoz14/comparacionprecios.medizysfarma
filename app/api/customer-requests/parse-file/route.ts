import { getVerifiedSession } from "@/lib/auth/dal";
import { parseWorkbook } from "@/lib/excel/parser";
import { detectRequestColumns } from "@/lib/solicitudes/detect-columns";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".xlsx", ".xls", ".xlsm", ".csv"];

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
      { error: "Formato no soportado. Solo se aceptan archivos .xlsx, .xls, .xlsm o .csv." },
      { status: 400 },
    );
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return Response.json({ error: "El archivo supera el límite de 10 MB." }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = await parseWorkbook(buffer, file.name);
    if (workbook.sheets.length === 0) {
      return Response.json({ error: "El archivo no contiene hojas legibles." }, { status: 400 });
    }

    const rows = workbook.getRows(workbook.sheets[0].name);
    const { headerRowIndex, productColumn, quantityColumn } = detectRequestColumns(rows);
    const dataRows = headerRowIndex === null ? rows : rows.slice(headerRowIndex + 1);

    const items = dataRows
      .map((row) => {
        const productRaw = row[productColumn];
        const text = productRaw === null || productRaw === undefined ? "" : String(productRaw).trim();
        const quantityRaw = quantityColumn !== null ? row[quantityColumn] : null;
        const quantity =
          quantityRaw === null || quantityRaw === undefined
            ? 1
            : Math.max(1, Math.round(Number(quantityRaw)) || 1);
        return { text, quantity };
      })
      .filter((item) => item.text !== "");

    return Response.json({ items, quantityColumnDetected: quantityColumn !== null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo leer el archivo.";
    return Response.json({ error: message }, { status: 400 });
  }
}
