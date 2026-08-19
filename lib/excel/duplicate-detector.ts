import type { ParsedOfferRow } from "@/lib/excel/types";

export interface DuplicateGroup {
  normalizedName: string;
  kept: ParsedOfferRow;
  discarded: ParsedOfferRow[];
  priceConflict: boolean;
}

/**
 * Agrupa filas del mismo archivo que representan el mismo producto (mismo
 * normalizedName). Se conserva la última fila y se descartan las anteriores;
 * si los precios entre duplicados difieren, se marca como conflicto de precio
 * para que quede en las advertencias del reporte.
 */
export function detectDuplicates(rows: ParsedOfferRow[]): {
  unique: ParsedOfferRow[];
  duplicateGroups: DuplicateGroup[];
} {
  const groups = new Map<string, ParsedOfferRow[]>();

  for (const row of rows) {
    const existing = groups.get(row.normalizedName);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(row.normalizedName, [row]);
    }
  }

  const unique: ParsedOfferRow[] = [];
  const duplicateGroups: DuplicateGroup[] = [];

  for (const [normalizedName, groupRows] of groups) {
    const kept = groupRows[groupRows.length - 1];
    unique.push(kept);

    if (groupRows.length > 1) {
      const discarded = groupRows.slice(0, -1);
      const priceConflict = groupRows.some((r) => r.price !== kept.price);
      duplicateGroups.push({ normalizedName, kept, discarded, priceConflict });
    }
  }

  return { unique, duplicateGroups };
}
