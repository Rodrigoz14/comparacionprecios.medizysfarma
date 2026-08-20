import type { ExtractedAttributes } from "@/lib/matching/types";

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
 * Identidad genérica de un producto: ingrediente activo + concentración + forma +
 * presentación, SIN laboratorio. Dos ofertas de laboratorios distintos para el
 * mismo genérico comparten esta clave (el laboratorio no es criterio de selección).
 */
export function buildGenericKey(attributes: ExtractedAttributes): string {
  const raw = [
    attributes.activeIngredient,
    attributes.concentration,
    attributes.concentrationUnit,
    attributes.dosageForm,
    `x${attributes.presentationQuantity}`,
  ].join(" ");
  return normalizeText(raw);
}

/**
 * Identidad exacta de un producto, incluyendo laboratorio: es la clave única de
 * la tabla Product. Cuando no se conoce el laboratorio se usa un sufijo fijo
 * para no colisionar con una futura fila que sí lo tenga.
 */
export function buildNormalizedName(
  attributes: ExtractedAttributes,
  laboratoryNormalizedName: string | null,
): string {
  const generic = buildGenericKey(attributes);
  return laboratoryNormalizedName ? `${generic} ${laboratoryNormalizedName}` : `${generic} sin-laboratorio`;
}
