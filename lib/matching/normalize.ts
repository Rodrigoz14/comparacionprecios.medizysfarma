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
 * Los proveedores no siempre escriben el ingrediente activo en el mismo orden:
 * Ramédicas alfabetiza como "VALPROICO ACIDO" mientras que Disfarma escribe
 * "ACIDO VALPROICO" para la misma sustancia (confirmado en datos reales: 33
 * ingredientes distintos, incluyendo combinaciones de varios principios,
 * afectados por esto). Ordenar las palabras alfabéticamente hace que ambas
 * formas produzcan la misma clave sin necesidad de registrar cada variante
 * como sinónimo — es una normalización estructural, no una inferencia de
 * equivalencia entre sustancias distintas.
 *
 * Se descarta cualquier "palabra" que no tenga ninguna letra (p. ej. "+" o
 * "(" sueltos, separados por espacio del resto). Sin esto, un combinado
 * escrito como "ALUMINIO HIDROXIDO + SIMETICONA" (con espacios alrededor del
 * "+") o con la concentración combinada entre paréntesis
 * ("...SIMETICONA (4G+4G+0.4G)/100ML...", que deja un "(" colgando al
 * cortar el nombre del producto) termina con "+" o "(" como si fueran una
 * palabra más del ingrediente, ensuciando la clave — confirmado en datos
 * reales: le pasaba a decenas de productos combinados de ambos proveedores.
 *
 * También se descartan las preposiciones "de"/"del": el patrón químico en
 * español "[Radical] de [Base]" (p. ej. "Cloruro de Sodio", "Bromuro de
 * Tiotropio", "Sulfato de Zinc") se escribe de forma inconsistente entre
 * proveedores y clientes — a veces con "de", a veces sin (confirmado en
 * datos reales: 697 productos del catálogo, ~6% del total, donde la misma
 * sustancia aparece escrita de ambas formas). Solo se filtran estas dos
 * palabras, no otras preposiciones/conectores en español ("y", "a", "la"),
 * porque esas sí pueden ser parte real de un nombre (p. ej. "Vitamina A").
 */
const IGNORED_CONNECTOR_WORDS = new Set(["de", "del"]);

export function canonicalizeIngredient(activeIngredient: string): string {
  return normalizeText(activeIngredient)
    .split(" ")
    .filter((word) => /[a-z]/.test(word))
    .filter((word) => !IGNORED_CONNECTOR_WORDS.has(word))
    .sort()
    .join(" ");
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
    canonicalizeIngredient(attributes.activeIngredient),
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
