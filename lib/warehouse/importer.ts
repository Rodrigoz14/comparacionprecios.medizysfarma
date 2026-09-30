import { mapWithConcurrency } from "@/lib/concurrency";
import { prisma } from "@/lib/db/client";
import { parseWorkbook } from "@/lib/excel/parser";
import { resolveProductMatch } from "@/lib/matching/matching-service";
import { normalizeText } from "@/lib/matching/normalize";
import { detectRequestColumns } from "@/lib/solicitudes/detect-columns";

export interface WarehouseImportRowError {
  text: string;
  quantity: number;
  reason: string;
}

export interface WarehouseImportReport {
  totalRows: number;
  matchedRows: number;
  unmatchedRows: number;
  distinctProducts: number;
  errors: WarehouseImportRowError[];
}

/**
 * Reemplaza el inventario de bodega completo a partir de un Excel con
 * producto + cantidad. Se homologa cada fila con el mismo motor de
 * homologación que las solicitudes de cliente (Sección 5), pero a diferencia
 * de una solicitud, aquí NINGUNA fila se descarta (confirmado con el
 * cliente, 2026-09-29: antes una fila sin `decision === "MATCH"` se perdía
 * del todo, sin quedar en ningún lado -- muchas de esas filas ni siquiera son
 * medicamentos, como gasas, sondas o insumos dentales que todavía no tienen
 * catálogo de proveedor propio, y su existencia real igual debe verse en
 * bodega). Las filas con match confiable se guardan bajo el `genericKey` del
 * producto real, agrupando cantidades entre filas del mismo genérico (p. ej.
 * mismo principio activo pero distinto laboratorio). Las que no tienen match
 * confiable se guardan igual, bajo su propio texto normalizado como clave
 * (nunca bajo el producto que la IA/heurística sugirió como "mejor
 * candidato" -- eso seguiría siendo adivinar a qué producto corresponde),
 * y quedan marcadas para revisión en el reporte.
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

  const matches = await mapWithConcurrency(parsedRows, 8, (row) => resolveProductMatch(row.text));

  // Una sola consulta para todos los productos matcheados, en vez de una por
  // fila: el genericKey no depende de cuál fila lo pidió.
  const matchedProductIds = [
    ...new Set(
      matches
        .filter((m) => m.decision === "MATCH" && m.matchedProductIds.length > 0)
        .map((m) => m.matchedProductIds[0]),
    ),
  ];
  const products = await prisma.product.findMany({
    where: { id: { in: matchedProductIds } },
    select: { id: true, genericKey: true },
  });
  const genericKeyByProductId = new Map(products.map((p) => [p.id, p.genericKey]));

  const stockByGenericKey = new Map<string, { quantity: number; rawProductName: string | null }>();
  const errors: WarehouseImportRowError[] = [];

  parsedRows.forEach((row, i) => {
    const match = matches[i];
    const isConfident = match.decision === "MATCH" && match.matchedProductIds.length > 0;
    if (!isConfident) {
      errors.push({
        text: row.text,
        quantity: row.quantity,
        reason: match.reasons[0] ?? "No se pudo identificar el producto con certeza.",
      });
    }
    // Sin match confiable, se agrupa por el propio texto normalizado -- NUNCA
    // por el "mejor candidato" que sugirió la homologación, porque eso sigue
    // siendo una suposición sin confirmar (el mismo criterio que ya se usa en
    // Solicitudes: REVIEW no es MATCH).
    const genericKey = isConfident ? genericKeyByProductId.get(match.matchedProductIds[0])! : normalizeText(row.text);
    const existing = stockByGenericKey.get(genericKey);
    stockByGenericKey.set(genericKey, {
      quantity: (existing?.quantity ?? 0) + row.quantity,
      rawProductName: isConfident ? null : row.text,
    });
  });

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
    matchedRows: parsedRows.length - errors.length,
    unmatchedRows: errors.length,
    distinctProducts: stockToSave.length,
    errors,
  };
}
