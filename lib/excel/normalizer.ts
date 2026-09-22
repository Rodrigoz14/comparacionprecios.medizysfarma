import type { Availability } from "@/lib/generated/prisma/client";
import { normalizeText } from "@/lib/matching/normalize";
import type { PriceFormat } from "@/lib/excel/types";

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

// Un serial de Excel es el número de días desde el 30/12/1899 (incluye el
// falso 29 de febrero de 1900 que Excel arrastra por compatibilidad con
// Lotus 1-2-3) -- solo hace falta como respaldo: ExcelJS/SheetJS ya
// convierten una celda con formato de fecha real a texto ISO
// (lib/excel/parser.ts), esto solo cubre el caso de una columna de fecha
// guardada como número plano sin formato.
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Convierte el valor de una columna de fecha de vencimiento (texto ISO,
 * "DD/MM/YYYY" colombiano, o un serial de Excel) a una fecha. Devuelve null
 * si no se puede interpretar -- una fecha inválida no debe bloquear la
 * importación de la fila, solo queda sin fecha de vencimiento registrada.
 */
export function parseExpirationDate(raw: string | number | null | undefined): Date | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return new Date(EXCEL_EPOCH_MS + raw * DAY_MS);
  }

  const text = raw.trim();
  if (!text) return null;

  const ddmmyyyy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
