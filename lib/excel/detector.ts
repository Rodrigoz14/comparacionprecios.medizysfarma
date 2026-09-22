import { normalizeText } from "@/lib/matching/normalize";
import type { ColumnTarget, DetectedColumn, RawRow } from "@/lib/excel/types";

const ALIASES: Record<ColumnTarget, string[]> = {
  supplierProductCode: ["codigo", "sku", "referencia", "ref", "cod"],
  productName: ["descripcion", "producto", "descripcion comercial", "nombre", "articulo"],
  presentation: ["presentacion", "empaque"],
  dosageForm: ["forma farmaceutica", "forma"],
  laboratory: ["laboratorio", "lab", "marca", "fabricante"],
  // Nota: se busca "precio x presentacion" antes que "precio x ud" (precio unitario)
  // porque comparamos precio por presentación completa, no por unidad suelta.
  price: ["precio x presentacion", "precio", "valor", "vlr", "vr"],
  tax: ["iva", "impuesto"],
  availability: ["disponible", "disponibilidad", "existencia", "stock", "cantidad disponible"],
  stock: ["stock", "existencia", "cantidad"],
  expirationDate: ["fecha vencimiento", "fec_venc", "vencimiento", "fecha vence", "caducidad"],
};

/**
 * Encuentra la fila de encabezados dentro de las primeras filas del archivo: la que
 * tenga más celdas coincidiendo con los alias conocidos.
 */
export function detectHeaderRowIndex(rows: RawRow[], maxRowsToScan = 10): number {
  let bestIndex = 0;
  let bestScore = -1;

  for (let i = 0; i < Math.min(maxRowsToScan, rows.length); i++) {
    const row = rows[i];
    let score = 0;
    for (const value of Object.values(row)) {
      if (typeof value !== "string") continue;
      const normalized = normalizeText(value);
      if (Object.values(ALIASES).some((list) => list.includes(normalized))) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}

export function detectColumns(headerRow: RawRow): DetectedColumn[] {
  const columns: DetectedColumn[] = [];
  const usedTargets = new Set<ColumnTarget>();

  const indices = Object.keys(headerRow)
    .map(Number)
    .sort((a, b) => a - b);

  for (const index of indices) {
    const rawHeader = headerRow[index];
    const header = rawHeader === null ? "" : String(rawHeader);
    const normalized = normalizeText(header);

    let proposedTarget: ColumnTarget | null = null;
    let confidence = 0;

    for (const [target, aliases] of Object.entries(ALIASES) as [ColumnTarget, string[]][]) {
      if (usedTargets.has(target)) continue;
      if (aliases.includes(normalized)) {
        proposedTarget = target;
        confidence = 1;
        break;
      }
      const partial = aliases.some((alias) => normalized.includes(alias) || alias.includes(normalized));
      if (partial && confidence < 0.6) {
        proposedTarget = target;
        confidence = 0.6;
      }
    }

    if (proposedTarget) usedTargets.add(proposedTarget);
    columns.push({ index, header, proposedTarget, confidence });
  }

  return columns;
}
