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
