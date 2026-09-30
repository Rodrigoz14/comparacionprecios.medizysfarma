import { prisma } from "@/lib/db/client";
import { parseWorkbook } from "@/lib/excel/parser";
import { extractProductAttributes } from "@/lib/matching/extract-attributes";
import { buildGenericKey, normalizeText } from "@/lib/matching/normalize";
import { detectRequestColumns } from "@/lib/solicitudes/detect-columns";

export interface WarehouseImportReport {
  totalRows: number;
  distinctProducts: number;
}

/**
 * Reemplaza el inventario de bodega completo a partir de un Excel con
 * producto + cantidad. Bodega NO tiene relación con el catálogo de
 * Proveedores (confirmado con el cliente, 2026-09-30): no se busca ni se
 * exige que el producto exista en ningún proveedor para guardarlo -- esa
 * relación solo importa después, al calcular una Solicitud (ahí sí se
 * compara el `genericKey` de bodega contra el del producto pedido). Aquí
 * solo se interpreta el propio texto de la fila (mismo motor de extracción
 * que usa el resto del sistema para identificar principio activo +
 * concentración + forma farmacéutica) para poder sumar cantidades entre
 * filas que describen el mismo genérico (p. ej. mismo medicamento escrito
 * distinto por error de tipeo o de otra presentación). Cuando el texto no
 * alcanza para identificar un genérico (p. ej. insumos sin principio
 * activo, como gasas o guantes), se agrupa por su propio texto normalizado
 * -- nunca se descarta la fila.
 */
export async function importWarehouseStock(buffer: Buffer, originalName: string): Promise<WarehouseImportReport> {
  const workbook = await parseWorkbook(buffer, originalName);
  if (workbook.sheets.length === 0) {
    throw new Error("El archivo no contiene hojas legibles.");
  }

  const rows = workbook.getRows(workbook.sheets[0].name);
  const { headerRowIndex, productColumn, quantityColumn } = detectRequestColumns(rows);
  const dataRows = headerRowIndex === null ? rows : rows.slice(headerRowIndex + 1);

  const parsedRows = dataRows
    .map((row) => {
      const productRaw = row[productColumn];
      const text = productRaw === null || productRaw === undefined ? "" : String(productRaw).trim();
      const quantityRaw = quantityColumn !== null ? row[quantityColumn] : null;
      const quantity =
        quantityRaw === null || quantityRaw === undefined ? 0 : Math.max(0, Math.round(Number(quantityRaw)) || 0);
      return { text, quantity };
    })
    .filter((row) => row.text !== "");

  const stockByGenericKey = new Map<string, { quantity: number; rawProductName: string }>();

  for (const row of parsedRows) {
    const extraction = extractProductAttributes(row.text, { requirePresentation: false });
    const genericKey = extraction ? buildGenericKey(extraction.attributes) : normalizeText(row.text);
    const existing = stockByGenericKey.get(genericKey);
    stockByGenericKey.set(genericKey, {
      quantity: (existing?.quantity ?? 0) + row.quantity,
      rawProductName: row.text,
    });
  }

  // Un genérico en 0 (incluida la suma de varias filas que dan 0 entre sí) no
  // aporta nada al inventario y solo genera confusión al mostrarlo -- no se
  // guarda, ni cuenta como producto distinto en el reporte.
  const stockToSave = [...stockByGenericKey.entries()].filter(([, v]) => v.quantity > 0);

  await prisma.$transaction([
    prisma.warehouseStock.deleteMany({}),
    prisma.warehouseStock.createMany({
      data: stockToSave.map(([genericKey, v]) => ({
        genericKey,
        quantity: v.quantity,
        rawProductName: v.rawProductName,
      })),
    }),
  ]);

  return {
    totalRows: parsedRows.length,
    distinctProducts: stockToSave.length,
  };
}
