import { stripAccents } from "@/lib/matching/normalize";
import type { ExtractedAttributes } from "@/lib/matching/types";

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
 * de una descripción de producto en texto libre (nombre de un proveedor o el texto
 * escrito por un cliente). Devuelve null si no se puede determinar la concentración
 * o la cantidad de presentación (los dos atributos críticos para no confundir
 * productos distintos): en ese caso debe marcarse para revisión, no completarse
 * con un valor adivinado.
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
