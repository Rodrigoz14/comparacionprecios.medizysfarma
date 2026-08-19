import type { Availability } from "@/lib/generated/prisma/client";
import type { ExtractedAttributes, PriceFormat } from "@/lib/excel/types";

export function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function normalizeText(value: string): string {
  return stripAccents(value)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Convierte un valor de precio (texto u número, en cualquier formato de separadores)
 * a un número decimal. Devuelve null si no se puede interpretar.
 */
export function parsePrice(raw: string | number | null | undefined, format: PriceFormat): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? Math.round(raw * 100) / 100 : null;
  }

  let text = raw.trim().replace(/[^0-9.,-]/g, "");
  if (text === "") return null;

  if (format.thousands !== "none") {
    text = text.split(format.thousands).join("");
  }
  if (format.decimal !== ".") {
    text = text.replace(format.decimal, ".");
  }

  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

/**
 * Propone un formato de precio a partir de una muestra de valores crudos del archivo.
 * La convención colombiana (miles con "." y decimales con ",") es el valor por defecto.
 */
export function detectPriceFormat(samples: Array<string | number | null | undefined>): PriceFormat {
  const textSamples = samples.filter((s): s is string => typeof s === "string" && s.trim() !== "");

  const withBoth = textSamples.filter((s) => s.includes(".") && s.includes(","));
  if (withBoth.length > 0) {
    const sample = withBoth[0];
    const lastDot = sample.lastIndexOf(".");
    const lastComma = sample.lastIndexOf(",");
    return lastComma > lastDot
      ? { thousands: ".", decimal: "," }
      : { thousands: ",", decimal: "." };
  }

  const withComma = textSamples.filter((s) => s.includes(","));
  if (withComma.length > 0) {
    return { thousands: ".", decimal: "," };
  }

  const withDot = textSamples.filter((s) => s.includes("."));
  if (withDot.length > 0) {
    const looksLikeDecimal = withDot.every((s) => {
      const parts = s.split(".");
      return parts.length === 2 && parts[1].length === 2;
    });
    if (looksLikeDecimal) {
      return { thousands: "none", decimal: "." };
    }
    return { thousands: ".", decimal: "," };
  }

  return { thousands: ".", decimal: "," };
}

const AVAILABLE_TOKENS = new Set(["si", "s", "disponible", "disp", "true", "yes", "x", "en stock"]);
const UNAVAILABLE_TOKENS = new Set(["no", "n", "agotado", "sin stock", "false", "0"]);

export function normalizeAvailability(raw: string | number | null | undefined): {
  availability: Availability;
  stock: number | null;
} {
  if (raw === null || raw === undefined || raw === "") {
    return { availability: "UNKNOWN", stock: null };
  }

  if (typeof raw === "number") {
    return raw > 0
      ? { availability: "AVAILABLE", stock: raw }
      : { availability: "OUT_OF_STOCK", stock: 0 };
  }

  const normalized = normalizeText(raw);

  if (/^\d+([.,]\d+)?$/.test(normalized)) {
    const numeric = Number.parseFloat(normalized.replace(",", "."));
    return numeric > 0
      ? { availability: "AVAILABLE", stock: numeric }
      : { availability: "OUT_OF_STOCK", stock: 0 };
  }

  if (AVAILABLE_TOKENS.has(normalized)) {
    return { availability: "AVAILABLE", stock: null };
  }
  if (UNAVAILABLE_TOKENS.has(normalized)) {
    return { availability: "OUT_OF_STOCK", stock: 0 };
  }

  return { availability: "UNKNOWN", stock: null };
}

const CONCENTRATION_RE = /(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)?)\s*(MG|MCG|UI|G|ML)\b/i;
const PRESENTATION_QTY_RE = /X\s*(\d+)\b/i;

const DOSAGE_FORM_MAP: Record<string, string> = {
  TAB: "Tableta",
  TABLETA: "Tableta",
  TABLETAS: "Tableta",
  COMPRIMIDO: "Tableta",
  COMPRIMIDOS: "Tableta",
  CAPS: "Cápsula",
  CAPSULA: "Cápsula",
  CAPSULAS: "Cápsula",
  JBE: "Jarabe",
  JARABE: "Jarabe",
  SUSP: "Suspensión",
  SUSPENSION: "Suspensión",
  SOL: "Solución",
  SOLUCION: "Solución",
  CREMA: "Crema",
  UNG: "Ungüento",
  UNGUENTO: "Ungüento",
  AMPOLLA: "Ampolla",
  AMP: "Ampolla",
  INY: "Inyectable",
  INYECTABLE: "Inyectable",
  GOTAS: "Gotas",
};

const PRESENTATION_TYPE_MAP: Record<string, string> = {
  CAJA: "Caja",
  FRASCO: "Frasco",
  BLISTER: "Blíster",
  SOBRE: "Sobre",
  TUBO: "Tubo",
};

const PRESENTATION_UNIT_BY_FORM: Record<string, string> = {
  Tableta: "tabletas",
  Cápsula: "cápsulas",
  Jarabe: "ml",
  Suspensión: "ml",
  Solución: "ml",
  Gotas: "ml",
  Crema: "g",
  Ungüento: "g",
  Ampolla: "ampollas",
  Inyectable: "ampollas",
};

/**
 * Extrae principio activo, concentración, forma farmacéutica y presentación a partir
 * de la descripción cruda de un producto. Devuelve null si no se puede determinar la
 * concentración o la cantidad de presentación (los dos atributos críticos para no
 * confundir productos distintos): en ese caso la fila debe marcarse como error, no
 * completarse con un valor adivinado.
 */
export function extractProductAttributes(
  rawName: string,
): { attributes: ExtractedAttributes; warnings: string[] } | null {
  const upper = stripAccents(rawName).toUpperCase();
  const warnings: string[] = [];

  const concentrationMatch = CONCENTRATION_RE.exec(upper);
  const presentationMatch = PRESENTATION_QTY_RE.exec(upper);

  if (!concentrationMatch || !presentationMatch) {
    return null;
  }

  const tokens = upper.split(/[^A-ZÁÉÍÓÚÑ]+/).filter(Boolean);

  let dosageForm: string | null = null;
  let dosageFormTokenIndex = -1;
  for (let i = 0; i < tokens.length; i++) {
    const mapped = DOSAGE_FORM_MAP[tokens[i]];
    if (mapped) {
      dosageForm = mapped;
      dosageFormTokenIndex = upper.indexOf(tokens[i]);
      break;
    }
  }
  if (!dosageForm) {
    dosageForm = "No especificada";
    warnings.push("No se pudo determinar la forma farmacéutica; se dejó 'No especificada'.");
  }

  let presentationType: string | null = null;
  for (const token of tokens) {
    const mapped = PRESENTATION_TYPE_MAP[token];
    if (mapped) {
      presentationType = mapped;
      break;
    }
  }
  if (!presentationType) {
    presentationType = "Caja";
    warnings.push("No se pudo determinar el tipo de empaque; se asumió 'Caja'.");
  }

  const cutIndex =
    dosageFormTokenIndex >= 0
      ? Math.min(dosageFormTokenIndex, concentrationMatch.index)
      : concentrationMatch.index;
  const activeIngredient = upper.slice(0, cutIndex).trim().replace(/\s+/g, " ");

  if (!activeIngredient) {
    return null;
  }

  const presentationUnit = PRESENTATION_UNIT_BY_FORM[dosageForm] ?? "unidades";

  return {
    attributes: {
      activeIngredient,
      concentration: concentrationMatch[1].replace(",", "."),
      concentrationUnit: concentrationMatch[2].toUpperCase(),
      dosageForm,
      presentationType,
      presentationQuantity: Number.parseInt(presentationMatch[1], 10),
      presentationUnit,
    },
    warnings,
  };
}

export function buildNormalizedName(attributes: ExtractedAttributes): string {
  const raw = [
    attributes.activeIngredient,
    attributes.concentration,
    attributes.concentrationUnit,
    attributes.dosageForm,
    `x${attributes.presentationQuantity}`,
  ].join(" ");
  return normalizeText(raw);
}
