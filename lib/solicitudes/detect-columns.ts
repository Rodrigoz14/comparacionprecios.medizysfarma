import type { RawRow } from "@/lib/excel/types";

function looksLikeQuantity(value: string | number | null): boolean {
  if (value === null) return false;
  // 0 cuenta como cantidad válida: un cliente no suele pedir "0" de algo,
  // pero en bodega un producto agotado sí queda registrado en 0 -- excluirlo
  // hacía que la columna de existencias no se detectara bien en archivos
  // reales, donde la mayoría de las filas están en cero (bug real).
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 && value < 100000;
  return /^\d+$/.test(value.trim());
}

function textLength(value: string | number | null): number {
  if (value === null) return 0;
  return String(value).trim().length;
}

/**
 * Detecta cuál columna trae la cantidad y cuál el producto en un archivo de
 * solicitud de cliente, sin asumir un orden fijo ni encabezados en un idioma
 * particular: la columna donde la mayoría de las filas parecen un número
 * entero pequeño es "cantidad"; entre las demás, la de texto más largo en
 * promedio es "producto". También detecta si la primera fila es encabezado
 * (no se ve como un dato válido) o ya es la primera fila de datos.
 */
/**
 * Algunos archivos reales (p. ej. el Kardex de bodega) traen un título y una
 * fecha en las primeras filas antes del encabezado real -- se escanean hasta
 * `maxHeaderRowsToScan` filas y se toma la última que no parezca fila de
 * datos (ninguna celda parece cantidad, y tiene al menos 2 celdas con texto,
 * para no confundir una fila de título de una sola celda con el encabezado)
 * justo antes de la primera fila que sí parece datos reales. Antes solo se
 * miraba la fila 0, así que un archivo con filas de título arriba del
 * encabezado nunca lo encontraba (bug real reportado por el cliente).
 */
export function detectRequestColumns(
  rows: RawRow[],
  maxHeaderRowsToScan = 10,
): {
  headerRowIndex: number | null;
  productColumn: number;
  quantityColumn: number | null;
} {
  let headerRowIndex: number | null = null;
  for (let i = 0; i < Math.min(maxHeaderRowsToScan, rows.length); i++) {
    const values = Object.values(rows[i]);
    if (values.some(looksLikeQuantity)) break; // primera fila que ya parece datos reales
    const nonEmptyCount = values.filter((v) => v !== null && String(v).trim() !== "").length;
    if (nonEmptyCount >= 2) headerRowIndex = i;
  }
  const dataRows = headerRowIndex === null ? rows : rows.slice(headerRowIndex + 1);
  const sample = dataRows.slice(0, 30);

  const columnIndices = [...new Set(sample.flatMap((r) => Object.keys(r).map(Number)))].sort((a, b) => a - b);

  let quantityColumn: number | null = null;
  let bestQuantityScore = 0;
  for (const col of columnIndices) {
    const values = sample.map((r) => r[col] ?? null).filter((v) => v !== null);
    if (values.length === 0) continue;
    const score = values.filter(looksLikeQuantity).length / values.length;
    if (score > 0.5 && score > bestQuantityScore) {
      bestQuantityScore = score;
      quantityColumn = col;
    }
  }

  let productColumn = columnIndices.find((c) => c !== quantityColumn) ?? 0;
  let bestLength = -1;
  for (const col of columnIndices) {
    if (col === quantityColumn) continue;
    const values = sample.map((r) => r[col] ?? null);
    const avgLength = values.reduce<number>((sum, v) => sum + textLength(v), 0) / Math.max(values.length, 1);
    if (avgLength > bestLength) {
      bestLength = avgLength;
      productColumn = col;
    }
  }

  return { headerRowIndex, productColumn, quantityColumn };
}
