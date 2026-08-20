import type { Availability } from "@/lib/generated/prisma/client";
import type { ExtractedAttributes } from "@/lib/matching/types";

/// Campos estándar internos a los que se mapean las columnas del archivo del proveedor.
export type ColumnTarget =
  | "supplierProductCode"
  | "productName"
  | "presentation"
  | "dosageForm"
  | "laboratory"
  | "price"
  | "tax"
  | "availability"
  | "stock";

export const REQUIRED_COLUMN_TARGETS: ColumnTarget[] = ["productName", "price"];

export interface ColumnMapping {
  /// Índice de columna (0-based) en la hoja -> campo estándar. Una columna puede no mapearse (undefined).
  [target: string]: number | undefined;
}

export interface PriceFormat {
  thousands: "." | "," | "none";
  decimal: "." | ",";
}

export interface SheetInfo {
  name: string;
  rowCount: number;
}

export interface DetectedColumn {
  index: number;
  header: string;
  proposedTarget: ColumnTarget | null;
  confidence: number;
}

export interface AnalyzeResult {
  sheets: SheetInfo[];
  selectedSheet: string;
  headerRowIndex: number;
  columns: DetectedColumn[];
  proposedPriceFormat: PriceFormat;
  previewRows: RawRow[];
  fileToken: string;
  alreadyImported: {
    supplierFileId: string;
    processedAt: Date | null;
    receivedAt: Date;
  } | null;
}

/// Una fila cruda de la hoja, tal como viene, indexada por número de columna.
export type RawRow = Record<number, string | number | null>;

export interface ParsedOfferRow {
  rowNumber: number;
  supplierProductCode: string | null;
  originalProductName: string;
  normalizedName: string;
  genericKey: string;
  attributes: ExtractedAttributes;
  attributeWarnings: string[];
  laboratoryName: string | null;
  price: number;
  tax: number | null;
  availability: Availability;
  stock: number | null;
}

export interface RowIssue {
  rowNumber: number;
  message: string;
}

export interface ImportReport {
  supplierFileId: string;
  totalRows: number;
  importedRows: number;
  newProducts: number;
  updatedOffers: number;
  errorRows: number;
  warningRows: number;
  errors: RowIssue[];
  warnings: RowIssue[];
}
