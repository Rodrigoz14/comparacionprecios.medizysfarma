import type { ParsedOfferRow } from "@/lib/excel/types";

export interface DuplicateGroup {
  normalizedName: string;
  kept: ParsedOfferRow;
  discarded: ParsedOfferRow[];
  priceConflict: boolean;
}

// Dos filas con el mismo normalizedName pero un código de proveedor
// DISTINTO no son la misma oferta -- confirmado con el cliente
// (2026-09-23): el nombre puede coincidir mientras el producto real varía
// (lote, registro, etc.) sin que el texto lo refleje. Solo se agrupan como
// "la misma fila repetida" cuando además coinciden en el código (o ninguna
// de las dos lo trae).
function duplicateKey(row: ParsedOfferRow): string {
  return `${row.normalizedName}\u0000${row.supplierProductCode ?? ""}`;
}

/**
 * Agrupa filas del mismo archivo que representan exactamente la misma oferta
 * (mismo normalizedName Y mismo código de proveedor). Se conserva la última
 * fila y se descartan las anteriores; si los precios entre duplicados
 * difieren, se marca como conflicto de precio para que quede en las
 * advertencias del reporte.
 */
export function detectDuplicates(rows: ParsedOfferRow[]): {
  unique: ParsedOfferRow[];
  duplicateGroups: DuplicateGroup[];
} {
  const groups = new Map<string, ParsedOfferRow[]>();

  for (const row of rows) {
    const key = duplicateKey(row);
    const existing = groups.get(key);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  const unique: ParsedOfferRow[] = [];
  const duplicateGroups: DuplicateGroup[] = [];

  for (const groupRows of groups.values()) {
    const kept = groupRows[groupRows.length - 1];
    unique.push(kept);

    if (groupRows.length > 1) {
      const discarded = groupRows.slice(0, -1);
      const priceConflict = groupRows.some((r) => r.price !== kept.price);
      duplicateGroups.push({ normalizedName: kept.normalizedName, kept, discarded, priceConflict });
    }
  }

  return { unique, duplicateGroups };
}
