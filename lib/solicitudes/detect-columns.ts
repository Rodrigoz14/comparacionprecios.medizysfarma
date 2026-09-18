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

const CLIENT_HEADER_ALIASES = [
  "cliente",
  "clientes",
  "eps",
  "entidad",
  "paciente",
  "institucion",
  "institución",
  "afiliado",
  "cuenta",
];

/**
 * Algunos archivos reales de solicitud traen varios clientes mezclados en un
 * mismo Excel (columna propia con el nombre/código del cliente en cada fila,
 * p. ej. "SALUD V", "SANTOS" repetidos varias veces) -- se detecta esa
 * columna para poder dividir la solicitud en secciones por cliente y, al
 * exportar el pedido a proveedores, indicar de cuál cliente es cada fila.
 *
 * Primero se busca un encabezado conocido (cliente/EPS/entidad/paciente...);
 * si no hay encabezado o no coincide con ninguno, se usa una heurística: una
 * columna de texto corto (no es una descripción de producto) cuyos valores
 * se repiten bastante entre filas (varias filas del mismo cliente), a
 * diferencia de la columna de producto, que casi nunca repite texto exacto.
 */
function detectClientColumn(
  rows: RawRow[],
  headerRowIndex: number | null,
  sample: RawRow[],
  productColumn: number,
  quantityColumn: number | null,
): number | null {
  const candidateColumns = [...new Set(sample.flatMap((r) => Object.keys(r).map(Number)))].filter(
    (c) => c !== productColumn && c !== quantityColumn,
  );
  if (candidateColumns.length === 0) return null;

  if (headerRowIndex !== null) {
    const headerRow = rows[headerRowIndex];
    for (const col of candidateColumns) {
      const header = headerRow[col];
      if (header === null || header === undefined) continue;
      const normalized = String(header).trim().toLowerCase();
      if (CLIENT_HEADER_ALIASES.some((alias) => normalized.includes(alias))) return col;
    }
  }

  let bestColumn: number | null = null;
  let bestRepetitionRatio = 0;
  for (const col of candidateColumns) {
    const values = sample
      .map((r) => r[col])
      .filter((v): v is string | number => v !== null && v !== undefined && String(v).trim() !== "");
    if (values.length < 2) continue;
    const avgLength = values.reduce<number>((sum, v) => sum + String(v).trim().length, 0) / values.length;
    if (avgLength > 40) continue; // un nombre de cliente es corto, no una descripción de producto
    const distinctValues = new Set(values.map((v) => String(v).trim().toLowerCase())).size;
    const repetitionRatio = 1 - distinctValues / values.length; // mas cerca de 1 = mas repetido
    if (repetitionRatio > 0.3 && repetitionRatio > bestRepetitionRatio) {
      bestRepetitionRatio = repetitionRatio;
      bestColumn = col;
    }
  }
  return bestColumn;
}

/**
 * Detecta cuál columna trae la cantidad, cuál el producto y cuál (si la hay)
 * el cliente en un archivo de solicitud, sin asumir un orden fijo ni
 * encabezados en un idioma particular: la columna donde la mayoría de las
 * filas parecen un número entero pequeño es "cantidad"; entre las demás, la
 * de texto más largo en promedio es "producto". También detecta si la
 * primera fila es encabezado (no se ve como un dato válido) o ya es la
 * primera fila de datos.
 *
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
  clientColumn: number | null;
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

  const clientColumn = detectClientColumn(rows, headerRowIndex, sample, productColumn, quantityColumn);

  return { headerRowIndex, productColumn, quantityColumn, clientColumn };
}
