import { prisma } from "@/lib/db/client";
import { parseWorkbook } from "@/lib/excel/parser";
import { resolveProductMatch } from "@/lib/matching/matching-service";
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
 * Corre `fn` sobre `items` con un máximo de `concurrency` en vuelo a la vez,
 * en vez de uno por uno. Homologar cada fila implica al menos una consulta
 * real a la base de datos (y a veces una llamada a la IA); en serie, un
 * inventario de varios miles de filas superaba el límite de tiempo de la
 * función (5 minutos) sin terminar -- bug real reportado por el cliente.
 */
async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * Reemplaza el inventario de bodega completo a partir de un Excel con
 * producto + cantidad. Se homologa cada fila con el mismo motor de
 * homologación que las solicitudes de cliente (Sección 5): solo las filas
 * con `decision === "MATCH"` entran al inventario, para no adivinar a qué
 * producto corresponde una fila ambigua. Se agrupa por `genericKey`, así
 * que dos filas que caen en el mismo genérico (p. ej. mismo principio activo
 * pero distinto laboratorio en la fila del Excel) suman sus cantidades.
 */
export async function importWarehouseStock(buffer: Buffer, originalName: string): Promise<WarehouseImportReport> {
  const workbook = await parseWorkbook(buffer, originalName);
  if (workbook.sheets.length === 0) {
    throw new Error("El archivo no contiene hojas legibles.");
  }

  const rows = workbook.getRows(workbook.sheets[0].name);
  const { headerRowIndex, productColumn, quantityColumn } = detectRequestColumns(rows);
  const dataRows = headerRowIndex === null ? rows : rows.slice(1);

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

  const stockByGenericKey = new Map<string, number>();
  const errors: WarehouseImportRowError[] = [];

  parsedRows.forEach((row, i) => {
    const match = matches[i];
    if (match.decision !== "MATCH" || match.matchedProductIds.length === 0) {
      errors.push({
        text: row.text,
        quantity: row.quantity,
        reason: match.reasons[0] ?? "No se pudo identificar el producto con certeza.",
      });
      return;
    }

    const genericKey = genericKeyByProductId.get(match.matchedProductIds[0])!;
    stockByGenericKey.set(genericKey, (stockByGenericKey.get(genericKey) ?? 0) + row.quantity);
  });

  await prisma.$transaction([
    prisma.warehouseStock.deleteMany({}),
    prisma.warehouseStock.createMany({
      data: [...stockByGenericKey.entries()].map(([genericKey, quantity]) => ({ genericKey, quantity })),
    }),
  ]);

  return {
    totalRows: parsedRows.length,
    matchedRows: parsedRows.length - errors.length,
    unmatchedRows: errors.length,
    distinctProducts: stockByGenericKey.size,
    errors,
  };
}
