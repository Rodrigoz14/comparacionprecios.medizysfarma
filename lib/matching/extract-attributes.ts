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
 * Busca una forma farmacéutica conocida dentro de un texto (tokenizando por
 * palabras) y la normaliza al vocabulario controlado (DOSAGE_FORM_MAP).
 * Devuelve null si no reconoce ninguna palabra clave.
 */
export function normalizeDosageForm(rawText: string): string | null {
  const upper = stripAccents(rawText).toUpperCase();
  const tokens = upper.split(/[^A-ZÁÉÍÓÚÑ]+/).filter(Boolean);
  for (const token of tokens) {
    const mapped = DOSAGE_FORM_MAP[token];
    if (mapped) return mapped;
  }
  return null;
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

  const tokens = upper.split(/[^A-ZÁÉÍÓÚÑ]+/).filter(Boolean);
  const dosageFormTokenIndex = tokens.findIndex((token) => DOSAGE_FORM_MAP[token]);
  const ingredientTokens = dosageFormTokenIndex >= 0 ? tokens.slice(0, dosageFormTokenIndex) : tokens;
  const ingredient = ingredientTokens.join(" ").trim();
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
