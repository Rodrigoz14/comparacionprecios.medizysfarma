import type { ParsedOfferRow } from "@/lib/excel/types";

export interface DuplicateGroup {
  normalizedName: string;
  kept: ParsedOfferRow;
  discarded: ParsedOfferRow[];
  priceConflict: boolean;
}

// Dos filas con el mismo normalizedName pero un código de proveedor O una
// vigencia (FEC_VENC) DISTINTA no son la misma oferta -- confirmado con el
// cliente (2026-09-23): el nombre y hasta el código pueden coincidir
// mientras se trata de LOTES reales distintos (p. ej. mismo código, uno
// "SUPERIOR A 12 MESES" y otro "FECHA CORTA MARZO"). Solo se agrupan como
// "la misma fila repetida" cuando coinciden en TODO (o ninguna de las dos
// trae código/vigencia).
function duplicateKey(row: ParsedOfferRow): string {
  return `${row.normalizedName}\u0000${row.supplierProductCode ?? ""}\u0000${row.expirationLabel ?? ""}`;
}

/**
 * Agrupa filas del mismo archivo que representan exactamente la misma oferta
 * (mismo normalizedName, mismo código de proveedor y misma vigencia). Se
 * conserva la última fila y se descartan las anteriores; si los precios
 * entre duplicados difieren, se marca como conflicto de precio para que
 * quede en las advertencias del reporte.
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
