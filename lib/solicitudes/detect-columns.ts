import type { RawRow } from "@/lib/excel/types";

function looksLikeQuantity(value: string | number | null): boolean {
  if (value === null) return false;
  if (typeof value === "number") return Number.isInteger(value) && value > 0 && value < 100000;
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
export function detectRequestColumns(rows: RawRow[]): {
  headerRowIndex: number | null;
  productColumn: number;
  quantityColumn: number | null;
} {
  const firstRow = rows[0] ?? {};
  const firstRowLooksLikeHeader = !Object.values(firstRow).some((v) => looksLikeQuantity(v));
  const headerRowIndex = firstRowLooksLikeHeader ? 0 : null;
  const dataRows = headerRowIndex === null ? rows : rows.slice(1);
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
