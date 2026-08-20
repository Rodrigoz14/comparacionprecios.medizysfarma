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
 * Identidad del medicamento: ingrediente activo + concentración + forma
 * farmacéutica, SIN presentación ni laboratorio. Es la clave por la que se
 * agrupan y comparan ofertas: el mismo Sildenafil 100mg en caja x30 (Ramédicas)
 * y caja x100 (Disfarma) comparten esta clave, porque para Medizys son el
 * mismo medicamento — el precio se compara por unidad, no por presentación
 * (el laboratorio tampoco es criterio de selección, por la misma razón).
 */
export function buildGenericKey(attributes: ExtractedAttributes): string {
  const raw = [
    attributes.activeIngredient,
    attributes.concentration,
    attributes.concentrationUnit,
    attributes.dosageForm,
  ].join(" ");
  return normalizeText(raw);
}

/**
 * Identidad exacta de una oferta: genérico + presentación + laboratorio. Es la
 * clave única de la tabla Product — dos filas con la misma clave genérica pero
 * distinta presentación (caja x30 vs x100) o laboratorio son productos
 * (ofertas) distintos, aunque se comparen entre sí por precio unitario.
 * Cuando no se conoce el laboratorio se usa un sufijo fijo para no colisionar
 * con una futura fila que sí lo tenga.
 */
export function buildNormalizedName(
  attributes: ExtractedAttributes,
  laboratoryNormalizedName: string | null,
): string {
  const generic = buildGenericKey(attributes);
  const presentation = `x${attributes.presentationQuantity}`;
  const lab = laboratoryNormalizedName ?? "sin-laboratorio";
  return normalizeText(`${generic} ${presentation} ${lab}`);
}
