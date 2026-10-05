import type { ExtractedAttributes } from "@/lib/matching/types";

/** Los únicos 4 campos que de verdad identifican el genérico (ver buildGenericKey) -- deja pasar cualquier objeto que los tenga, sin exigir presentación. */
type GenericIdentity = Pick<ExtractedAttributes, "activeIngredient" | "concentration" | "concentrationUnit" | "dosageForm">;

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
export function buildGenericKey(attributes: GenericIdentity): string {
  const raw = [
    canonicalizeIngredient(attributes.activeIngredient),
    attributes.concentration,
    attributes.concentrationUnit,
    attributes.dosageForm,
  ].join(" ");
  return normalizeText(raw);
}

/**
 * Variantes EQUIVALENTES de la clave genérica de un producto -- mismo
 * principio activo y forma farmacéutica, pero la concentración convertida a
 * otra unidad que significa exactamente lo mismo (p. ej. "1000MG" y "1G" son
 * la misma dosis; "1%" y "10MG/ML" son la misma concentración real). A
 * petición del cliente (2026-10-05): en vez de guardar varias claves por
 * producto (requeriría migrar el esquema y mantenerlas sincronizadas en cada
 * importación), se CALCULAN en el momento de buscar -- cubre lo mismo sin
 * tocar la base de datos ni necesitar otro backfill cada vez que se agregue
 * una unidad nueva.
 *
 * Nunca se aplica a concentraciones combinadas (dos principios activos,
 * "500/125") ni a razones dosis/volumen de una forma sellada ("10/20" de
 * Baclofeno 10mg/20ml) -- esas ya tienen un significado propio que depende
 * del formato exacto (ver fix de Baclofeno/Enoxaparina/Dexmedetomidina,
 * 2026-10-02): convertir esos números produciría alias que vuelven a
 * fusionar presentaciones reales distintas, justo el bug que esos fixes
 * corrigieron.
 *
 * A PROPÓSITO no convierte "%" <-> "MG": % siempre es una TASA (g por cada
 * 100 mL o 100 g, independiente del tamaño del envase), mientras que un "MG"
 * simple (sin razón "/ML") es el contenido TOTAL de ese envase puntual --
 * convertir uno al otro sin saber el volumen real produciría alias
 * matemáticamente incorrectos (p. ej. "500MG" en un frasco de 250ml NO es
 * "5%": son 2 mg/ml = 0,2%, no 5%). La equivalencia %-a-mg/ml que SÍ es
 * segura (cuando la razón completa está presente, "2G/10ML" = "20%") ya la
 * resuelve `extractProductAttributes` al construir la clave principal, no
 * hace falta repetirla aquí.
 *
 * La forma farmacéutica NUNCA cambia en un alias -- por eso una conversión de
 * unidad nunca termina coincidiendo por accidente con otra presentación que
 * tenga el mismo número pero una forma distinta: la clave siempre incluye la
 * forma, así que ambas presentaciones nunca podrían colisionar.
 */
export function buildGenericKeyAliases(attributes: GenericIdentity): string[] {
  if (attributes.concentration.includes("/")) return [];
  const unit = attributes.concentrationUnit.toUpperCase();
  const value = Number.parseFloat(attributes.concentration);
  if (!Number.isFinite(value)) return [];

  const aliases = new Set<string>();
  const addVariant = (newValue: number, newUnit: string) => {
    const rounded = Math.round(newValue * 1_000_000) / 1_000_000;
    aliases.add(buildGenericKey({ ...attributes, concentration: String(rounded), concentrationUnit: newUnit }));
  };

  // Escala de masa: MCG <-> MG <-> G (1 g = 1.000 mg = 1.000.000 mcg) --
  // siempre exacta, sin importar la forma farmacéutica ni el volumen.
  if (unit === "MCG") {
    addVariant(value / 1000, "MG");
    addVariant(value / 1_000_000, "G");
  } else if (unit === "MG") {
    addVariant(value * 1000, "MCG");
    addVariant(value / 1000, "G");
  } else if (unit === "G") {
    addVariant(value * 1000, "MG");
    addVariant(value * 1_000_000, "MCG");
  }

  const primary = buildGenericKey(attributes);
  aliases.delete(primary);
  return [...aliases];
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
