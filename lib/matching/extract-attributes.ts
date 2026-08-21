import { stripAccents } from "@/lib/matching/normalize";
import type { ExtractedAttributes } from "@/lib/matching/types";

const CONCENTRATION_RE = /(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)?)\s*(MG|MCG|UI|G|ML)\b/i;
// El símbolo de multiplicación varía por proveedor: "X100" (Ramédicas) o
// "*30"/"C*1" (Disfarma). Cubre tanto conteos discretos ("X100" -> 100
// tabletas) como volumen/peso por envase pegado a la unidad, sin espacio
// ("X 30ML", "*400G", "X 1.5L"). Con bandera global: cuando el texto trae
// varias coincidencias (p. ej. "C*1 FCO X 240ML"), se prefiere la que
// especifica volumen/peso sobre un conteo de envases genérico.
const PRESENTATION_QTY_RE = /[X*]\s*(\d+(?:[.,]\d+)?)\s*(ML|L|G)?\b/gi;
// Envases de una sola unidad donde el proveedor no escribe "X1" (p. ej.
// biológicos/oncológicos vendidos como "CAJA X VIAL"): se asume cantidad 1.
const SINGLE_UNIT_CONTAINER_RE = /[X*]\s*(VIAL|AMPOLLA|AMPOLLAS|JERINGA|FRASCO|TUBO|SOBRE)\b/i;

const DOSAGE_FORM_MAP: Record<string, string> = {
  TAB: "Tableta",
  TABLETA: "Tableta",
  TABLETAS: "Tableta",
  COMPRIMIDO: "Tableta",
  COMPRIMIDOS: "Tableta",
  CAP: "Cápsula",
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
  CREM: "Crema",
  GEL: "Gel",
  UNG: "Ungüento",
  UNGUENTO: "Ungüento",
  AMPOLLA: "Ampolla",
  AMP: "Ampolla",
  INY: "Inyectable",
  INYECTABLE: "Inyectable",
  GOTAS: "Gotas",
};

/**
 * Algunas formas farmacéuticas solo se distinguen correctamente con la vía de
 * administración (una crema vaginal y una crema tópica no son intercambiables),
 * pero DOSAGE_FORM_MAP solo mira una palabra a la vez y "CREMA" sola encontraría
 * primero y pararía ahí, perdiendo la palabra "VAGINAL" que viene después. Se
 * revisan frases completas ANTES que palabras sueltas para no perder esa
 * distinción — visto en datos reales de Disfarma ("CREM VAG", columna de forma
 * farmacéutica separada) y de Ramédicas ("CREMA VAGINAL", dentro del nombre).
 */
const COMPOUND_DOSAGE_FORM_MAP: Record<string, string> = {
  "CREMA VAGINAL": "Crema vaginal",
  "CREM VAG": "Crema vaginal",
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
  "Crema vaginal": "g",
  Gel: "g",
  Ungüento: "g",
  Ampolla: "ampollas",
  Inyectable: "ampollas",
};

/**
 * Busca una forma farmacéutica conocida dentro de un texto ya en mayúsculas:
 * primero frases compuestas (COMPOUND_DOSAGE_FORM_MAP, para no perder la vía de
 * administración), luego palabras sueltas (DOSAGE_FORM_MAP). Devuelve también
 * en qué posición del texto empieza la coincidencia, para poder cortar ahí el
 * nombre del producto y no confundir la forma con el principio activo.
 */
function matchDosageForm(upper: string): { dosageForm: string; index: number } | null {
  for (const [phrase, mapped] of Object.entries(COMPOUND_DOSAGE_FORM_MAP)) {
    const index = upper.indexOf(phrase);
    if (index >= 0) return { dosageForm: mapped, index };
  }
  const tokens = upper.split(/[^A-ZÁÉÍÓÚÑ]+/).filter(Boolean);
  for (const token of tokens) {
    const mapped = DOSAGE_FORM_MAP[token];
    if (mapped) return { dosageForm: mapped, index: upper.indexOf(token) };
  }
  return null;
}

/**
 * Busca una forma farmacéutica conocida dentro de un texto y la normaliza al
 * vocabulario controlado. Devuelve null si no reconoce nada.
 */
export function normalizeDosageForm(rawText: string): string | null {
  const upper = stripAccents(rawText).toUpperCase();
  return matchDosageForm(upper)?.dosageForm ?? null;
}

/**
 * Extrae principio activo, concentración, forma farmacéutica y presentación a partir
 * de una descripción de producto en texto libre (nombre de un proveedor o el texto
 * escrito por un cliente). Devuelve null si no se puede determinar la concentración
 * o la cantidad de presentación (los dos atributos críticos para no confundir
 * productos distintos): en ese caso debe marcarse para revisión, no completarse
 * con un valor adivinado.
 */
// Etiquetas de canal/categoría que algunos proveedores anteponen al nombre
// del producto (p. ej. Disfarma: "EPS-ABACAVIR..."). No son parte del
// principio activo: si no se quitan, "EPS-ZOPICLONA" nunca coincide con lo
// que un cliente escribe normalmente ("Zopiclona").
const CHANNEL_PREFIX_RE = /^(EPS|POS|NO[\s-]?POS|PBS)[\s-]+/i;

export interface ExtractOptions {
  /**
   * Si es false, no exigir una cantidad de presentación explícita en el texto:
   * se asume 1 en vez de descartar la fila. Sirve para lo que escribe un
   * cliente ("Ácido Valproico 250mg", la cantidad va en un campo aparte), no
   * para archivos de proveedor, donde la presentación es un dato real que no
   * se debe adivinar (Sección 6: el precio por unidad depende de acertarla).
   * Por defecto true, para no cambiar el comportamiento de la importación.
   */
  requirePresentation?: boolean;
}

/**
 * Última red antes de rendirse: cuando el cliente escribe solo el nombre del
 * medicamento sin concentración (p. ej. "Ácido Valproico", sin decir cuál),
 * extractProductAttributes() devuelve null porque no hay suficiente para
 * identificar un producto exacto. En vez de terminar ahí en NO_MATCH, esto
 * devuelve una mejor suposición del ingrediente para poder mostrarle al
 * cliente qué concentraciones existen y que elija — nunca se adivina cuál es
 * la correcta, solo se ayuda a encontrar las opciones.
 *
 * Deliberadamente conservador: si el texto trae algún dígito, es más probable
 * que la concentración esté mal escrita que que no exista, y adivinar el
 * ingrediente ahí sería más arriesgado que útil — se prefiere no intentarlo.
 */
export function extractIngredientGuess(rawText: string): string | null {
  const upper = stripAccents(rawText).toUpperCase().replace(CHANNEL_PREFIX_RE, "").trim();
  if (!upper || /\d/.test(upper)) return null;

  const formMatch = matchDosageForm(upper);
  const ingredient = (formMatch ? upper.slice(0, formMatch.index) : upper).trim();
  return ingredient || null;
}

export function extractProductAttributes(
  rawName: string,
  options: ExtractOptions = {},
): { attributes: ExtractedAttributes; warnings: string[] } | null {
  const requirePresentation = options.requirePresentation ?? true;
  const upper = stripAccents(rawName).toUpperCase().replace(CHANNEL_PREFIX_RE, "");
  const warnings: string[] = [];

  const concentrationMatch = CONCENTRATION_RE.exec(upper);
  const presentationCandidates = [...upper.matchAll(PRESENTATION_QTY_RE)];
  // Cuando hay varias coincidencias (p. ej. "C*1 FCO X 240ML"), se prefiere
  // la que trae volumen/peso explícito sobre un conteo de envases genérico.
  const presentationMatch =
    presentationCandidates.find((m) => m[2]) ?? presentationCandidates[0] ?? null;
  const singleUnitMatch = presentationMatch ? null : SINGLE_UNIT_CONTAINER_RE.exec(upper);

  if (!concentrationMatch) {
    return null;
  }
  if (!presentationMatch && !singleUnitMatch && requirePresentation) {
    return null;
  }

  if (singleUnitMatch) {
    warnings.push(
      `No se encontró una cantidad explícita de presentación; se asumió 1 (envase "${singleUnitMatch[1]}").`,
    );
  } else if (!presentationMatch && !requirePresentation) {
    warnings.push("No se especificó presentación; no afecta la homologación (se compara por unidad).");
  }

  const tokens = upper.split(/[^A-ZÁÉÍÓÚÑ]+/).filter(Boolean);

  const formMatch = matchDosageForm(upper);
  let dosageForm = formMatch?.dosageForm ?? null;
  const dosageFormTokenIndex = formMatch?.index ?? -1;
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

  let presentationQuantity: number;
  let presentationUnit: string;
  if (presentationMatch) {
    const rawQuantity = Number.parseFloat(presentationMatch[1].replace(",", "."));
    const volumeUnit = presentationMatch[2]?.toUpperCase();
    if (volumeUnit === "L") {
      presentationQuantity = Math.round(rawQuantity * 1000);
      presentationUnit = "ml";
    } else if (volumeUnit === "ML") {
      presentationQuantity = Math.round(rawQuantity);
      presentationUnit = "ml";
    } else if (volumeUnit === "G") {
      presentationQuantity = Math.round(rawQuantity);
      presentationUnit = "g";
    } else {
      presentationQuantity = Math.round(rawQuantity);
      presentationUnit = PRESENTATION_UNIT_BY_FORM[dosageForm] ?? "unidades";
    }
  } else {
    presentationQuantity = 1;
    presentationUnit = PRESENTATION_UNIT_BY_FORM[dosageForm] ?? "unidades";
  }

  return {
    attributes: {
      activeIngredient,
      concentration: concentrationMatch[1].replace(",", "."),
      concentrationUnit: concentrationMatch[2].toUpperCase(),
      dosageForm,
      presentationType,
      presentationQuantity,
      presentationUnit,
    },
    warnings,
  };
}
