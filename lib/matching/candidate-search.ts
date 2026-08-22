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
  /** true si se encontró porque todas las palabras buscadas están contenidas en un principio activo con palabras adicionales. */
  viaSubsetMatch: boolean;
}

/**
 * Busca candidatos por principio activo (o sus sinónimos controlados, o
 * tolerando errores de tipeo/OCR si no hay nada exacto), sin filtrar todavía
 * por concentración/forma/presentación: esa comparación estructurada más fina
 * ocurre después, en compare-attributes.ts. Esto evita enviar toda la base de
 * datos a la IA más adelante (Sección 5.18). Es la base tanto de la búsqueda
 * normal (con concentración) como de la búsqueda "solo ingrediente" que se
 * usa cuando el cliente no dio concentración (matching-service.ts).
 */
export async function searchCandidatesByIngredientText(rawIngredient: string): Promise<CandidateSearchResult[]> {
  const normalizedIngredient = normalizeText(rawIngredient);
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
      viaSynonym: canonicalizeIngredient(product.activeIngredient) !== canonicalizeIngredient(rawIngredient),
      viaFuzzyMatch: false,
      viaSubsetMatch: false,
    }));
  }

  const distinctIngredientKeys = await prisma.product.findMany({
    where: { status: "ACTIVE" },
    distinct: ["ingredientKey"],
    select: { ingredientKey: true },
  });

  // Nada por texto exacto ni sinónimo: un combinado real a veces se busca sin
  // mencionar todos sus componentes (p. ej. "Hidroxido de aluminio +
  // Simeticona" para un producto real que también lleva "Magnesio
  // Hidroxido" — bug real reportado por el cliente). Si TODAS las palabras
  // buscadas están contenidas en la clave de un candidato (nunca al revés:
  // no se adivina un ingrediente que el cliente no mencionó), se ofrece para
  // revisión humana, nunca como MATCH automático (matching-service.ts lo
  // obliga a REVIEW igual que la tolerancia a typos). Se exige un mínimo de 2
  // palabras en la búsqueda y un máximo de 2 palabras adicionales en el
  // candidato para no disparar con un solo ingrediente común compartido por
  // decenas de combinados no relacionados.
  const queryWords = (ingredientKeys[0] ?? "").split(" ").filter(Boolean);
  if (queryWords.length >= 2) {
    const subsetKeys = distinctIngredientKeys
      .map((row) => row.ingredientKey)
      .filter((key) => {
        if (!key) return false;
        const candidateWords = key.split(" ").filter(Boolean);
        if (candidateWords.length <= queryWords.length) return false;
        if (candidateWords.length - queryWords.length > 2) return false;
        return queryWords.every((word) => candidateWords.includes(word));
      });

    if (subsetKeys.length > 0) {
      const subsetProducts = await prisma.product.findMany({
        where: { status: "ACTIVE", ingredientKey: { in: subsetKeys } },
      });
      return subsetProducts.map((product) => ({
        product: toCandidateProduct(product),
        viaSynonym: false,
        viaFuzzyMatch: false,
        viaSubsetMatch: true,
      }));
    }
  }

  // Tampoco hay coincidencia de subconjunto: se intenta con tolerancia a
  // errores de tipeo/OCR (p. ej. "valprico" en vez de "valproico"),
  // comparando contra los ingredientKey realmente existentes en el catálogo.
  // Nunca se auto-confirma un match encontrado así (matching-service.ts lo
  // obliga a REVIEW): es una ayuda para no perder la búsqueda por una letra,
  // no una inferencia de que dos sustancias distintas son la misma.
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
    viaSubsetMatch: false,
  }));
}

export async function searchCandidates(attributes: ExtractedAttributes): Promise<CandidateSearchResult[]> {
  return searchCandidatesByIngredientText(attributes.activeIngredient);
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
