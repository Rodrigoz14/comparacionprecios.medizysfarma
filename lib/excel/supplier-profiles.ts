import { stripAccents } from "@/lib/matching/normalize";
import type { ColumnTarget, RawRow } from "@/lib/excel/types";

/**
 * Perfiles de columnas FIJOS para proveedores conocidos, confirmados con el
 * cliente (2026-09-22): sus archivos siempre traen las mismas columnas con
 * los mismos encabezados, así que en vez de adivinar por alias genéricos
 * (lib/excel/detector.ts) se buscan por su nombre exacto -- más confiable, y
 * permite reglas propias de cada proveedor (excluir filas sin existencia,
 * precio por unidad en vez de por empaque) que no aplican en general.
 *
 * Si el proveedor no coincide con ninguno de estos, se sigue usando la
 * detección genérica de siempre, sin cambios.
 */
export interface SupplierColumnProfile {
  key: string;
  /** Coincide por nombre de proveedor (insensible a mayúsculas/acentos). */
  matchesSupplierName: (name: string) => boolean;
  /** Encabezado EXACTO esperado en el archivo (se compara normalizado) -> campo estándar. */
  columns: Partial<Record<ColumnTarget, string>>;
  /**
   * Cuando es true, la columna mapeada como "stock" decide si una fila se
   * excluye por no tener existencia (valor <= 0): no se guarda, no aparece
   * en la previsualización ni se compara en Solicitudes -- mismo criterio
   * que ya se usa en Bodega para existencias en 0.
   */
  excludeZeroStock: boolean;
  /**
   * true cuando la columna de precio de este proveedor es el precio de UNA
   * unidad suelta, no del empaque completo -- se multiplica por las
   * unidades del empaque al importar (confirmado con el cliente,
   * 2026-09-22) para seguir el mismo criterio de "precio = empaque
   * completo" que usa el resto del motor de precios. No aplica a
   * ampollas/viales, que siempre se compran como 1 unidad sellada sin
   * importar su volumen (ver lib/pricing/measured-forms.ts).
   */
  priceIsPerUnit: boolean;
  /** Etiquetas amigables para mostrar en la previsualización del asistente de importación. */
  previewLabels: Partial<Record<ColumnTarget, string>>;
}

function normalizeHeaderName(value: string): string {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DISFARMA: SupplierColumnProfile = {
  key: "disfarma",
  matchesSupplierName: (name) => normalizeHeaderName(name).includes("disfarma"),
  columns: {
    supplierProductCode: "CODIGO",
    productName: "DESCRIPCION",
    price: "Ger_UPS_UND",
    dosageForm: "FORMA_FARMACEUTICA",
    presentation: "PRESENTACION",
    laboratory: "LABORATORIO",
  },
  excludeZeroStock: false,
  priceIsPerUnit: true,
  previewLabels: {
    supplierProductCode: "Código",
    productName: "Nombre",
    price: "Precio Und",
  },
};

const RAMEDICAS: SupplierColumnProfile = {
  key: "ramedicas",
  matchesSupplierName: (name) => normalizeHeaderName(name).includes("ramedicas"),
  columns: {
    supplierProductCode: "CODIGO INTERNO MEDICAMENTO",
    productName: "DESCRIPCION COMPLETA DE PRODUCTO",
    presentation: "PRESENTACION",
    price: "PRECIO X UD",
    laboratory: "LABORATORIO",
    stock: "STOCK ACTUAL",
  },
  excludeZeroStock: true,
  priceIsPerUnit: true,
  previewLabels: {
    supplierProductCode: "Código",
    productName: "Nombre",
    price: "Precio Und",
    stock: "Stock actual",
  },
};

const OFFIMEDICAS: SupplierColumnProfile = {
  key: "offimedicas",
  matchesSupplierName: (name) => normalizeHeaderName(name).includes("offimedicas"),
  columns: {
    supplierProductCode: "ID_PRODUCTO",
    productName: "PRODUCTO",
    laboratory: "LABORATORIO",
    stock: "CANTIDAD",
    price: "PRECIO UND",
  },
  excludeZeroStock: true,
  priceIsPerUnit: true,
  previewLabels: {
    supplierProductCode: "Código",
    productName: "Nombre",
    price: "Precio Und",
    stock: "Stock actual",
  },
};

const SUPPLIER_PROFILES: SupplierColumnProfile[] = [DISFARMA, RAMEDICAS, OFFIMEDICAS];

export function findSupplierProfile(supplierName: string): SupplierColumnProfile | null {
  return SUPPLIER_PROFILES.find((p) => p.matchesSupplierName(supplierName)) ?? null;
}

export interface ResolvedFixedMapping {
  mapping: Partial<Record<ColumnTarget, number>>;
  /** Encabezados esperados por el perfil que no se encontraron en este archivo. */
  missingColumns: string[];
}

/**
 * Busca cada columna esperada del perfil por su nombre exacto (normalizado:
 * sin acentos, mayúsculas/minúsculas y guiones bajos/espacios indistintos)
 * dentro de la fila de encabezados real del archivo.
 */
export function resolveFixedMapping(profile: SupplierColumnProfile, headerRow: RawRow): ResolvedFixedMapping {
  const normalizedHeaders = new Map<string, number>();
  for (const [indexStr, value] of Object.entries(headerRow)) {
    if (value === null) continue;
    const normalized = normalizeHeaderName(String(value));
    if (!normalizedHeaders.has(normalized)) normalizedHeaders.set(normalized, Number(indexStr));
  }

  const mapping: Partial<Record<ColumnTarget, number>> = {};
  const missingColumns: string[] = [];

  for (const [target, expectedHeader] of Object.entries(profile.columns) as [ColumnTarget, string][]) {
    const index = normalizedHeaders.get(normalizeHeaderName(expectedHeader));
    if (index === undefined) {
      missingColumns.push(expectedHeader);
      continue;
    }
    mapping[target] = index;
  }

  return { mapping, missingColumns };
}

/**
 * true cuando el valor de la columna de existencia (stock/cantidad) de esta
 * fila es <= 0 -- la fila debe excluirse por completo (Sección: perfiles de
 * proveedor, regla "excludeZeroStock").
 */
export function isZeroStockValue(raw: string | number | null | undefined): boolean {
  if (raw === null || raw === undefined) return false;
  const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw).trim().replace(",", "."));
  return Number.isFinite(n) && n <= 0;
}
