import { prisma } from "@/lib/db/client";
import { fuzzyIngredientThreshold, levenshteinDistance } from "@/lib/matching/fuzzy";
import { canonicalizeIngredient, normalizeText } from "@/lib/matching/normalize";
import { expandIngredientTerms } from "@/lib/matching/synonym-service";
import type { CandidateProduct, ExtractedAttributes } from "@/lib/matching/types";

export interface CandidateSearchResult {
  product: CandidateProduct;
  /** true si el candidato se encontró por un sinónimo, no por el mismo texto de ingrediente. */
  viaSynonym: boolean;
  /** true si se encontró tolerando un posible error de tipeo/OCR, no por el texto exacto ni un sinónimo controlado. */
  viaFuzzyMatch: boolean;
}

/**
 * Busca candidatos por principio activo (o sus sinónimos controlados), sin filtrar
 * todavía por concentración/forma/presentación: esa comparación estructurada más
 * fina ocurre después, en compare-attributes.ts. Esto evita enviar toda la base de
 * datos a la IA más adelante (Sección 5.18).
 */
export async function searchCandidates(attributes: ExtractedAttributes): Promise<CandidateSearchResult[]> {
  const normalizedIngredient = normalizeText(attributes.activeIngredient);
  const terms = await expandIngredientTerms(normalizedIngredient);
  // Se busca por ingredientKey (palabras ordenadas alfabéticamente) para que
  // no importe si el proveedor escribió "ACIDO VALPROICO" o "VALPROICO ACIDO".
  const ingredientKeys = [...new Set(terms.map((term) => canonicalizeIngredient(term)))];

  const products = await prisma.product.findMany({
    where: {
      status: "ACTIVE",
      ingredientKey: { in: ingredientKeys },
    },
  });

  if (products.length > 0) {
    return products.map((product) => ({
      product: toCandidateProduct(product),
      // Solo cuenta como sinónimo si el ingrediente en sí es distinto (p. ej.
      // paracetamol/acetaminofén); una variante de orden de palabras del mismo
      // ingrediente ("ACIDO VALPROICO" vs "VALPROICO ACIDO") no lo es.
      viaSynonym: canonicalizeIngredient(product.activeIngredient) !== canonicalizeIngredient(attributes.activeIngredient),
      viaFuzzyMatch: false,
    }));
  }

  // Nada por texto exacto ni sinónimo: se intenta con tolerancia a errores de
  // tipeo/OCR (p. ej. "valprico" en vez de "valproico"), comparando contra los
  // ingredientKey realmente existentes en el catálogo. Nunca se auto-confirma
  // un match encontrado así (matching-service.ts lo obliga a REVIEW): es una
  // ayuda para no perder la búsqueda por una letra, no una inferencia de que
  // dos sustancias distintas son la misma.
  const distinctIngredientKeys = await prisma.product.findMany({
    where: { status: "ACTIVE" },
    distinct: ["ingredientKey"],
    select: { ingredientKey: true },
  });

  const queryKey = ingredientKeys[0];
  const threshold = fuzzyIngredientThreshold(queryKey.length);
  const closeKeys = distinctIngredientKeys
    .map((row) => row.ingredientKey)
    .filter((key) => key.length > 0 && levenshteinDistance(queryKey, key) <= threshold);

  if (closeKeys.length === 0) return [];

  const fuzzyProducts = await prisma.product.findMany({
    where: { status: "ACTIVE", ingredientKey: { in: closeKeys } },
  });

  return fuzzyProducts.map((product) => ({
    product: toCandidateProduct(product),
    viaSynonym: false,
    viaFuzzyMatch: true,
  }));
}

function toCandidateProduct(product: {
  id: string;
  standardName: string;
  normalizedName: string;
  genericKey: string;
  activeIngredient: string;
  concentration: string;
  concentrationUnit: string;
  dosageForm: string;
  presentationType: string;
  presentationQuantity: number;
  presentationUnit: string;
  laboratoryId: string | null;
}): CandidateProduct {
  return {
    id: product.id,
    standardName: product.standardName,
    normalizedName: product.normalizedName,
    genericKey: product.genericKey,
    activeIngredient: product.activeIngredient,
    concentration: product.concentration,
    concentrationUnit: product.concentrationUnit,
    dosageForm: product.dosageForm,
    presentationType: product.presentationType,
    presentationQuantity: product.presentationQuantity,
    presentationUnit: product.presentationUnit,
    laboratoryId: product.laboratoryId,
  };
}
