import { prisma } from "@/lib/db/client";
import { normalizeText } from "@/lib/matching/normalize";
import { expandIngredientTerms } from "@/lib/matching/synonym-service";
import type { CandidateProduct, ExtractedAttributes } from "@/lib/matching/types";

export interface CandidateSearchResult {
  product: CandidateProduct;
  /** true si el candidato se encontró por un sinónimo, no por el mismo texto de ingrediente. */
  viaSynonym: boolean;
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

  const products = await prisma.product.findMany({
    where: {
      status: "ACTIVE",
      OR: terms.map((term) => ({ activeIngredient: { equals: term, mode: "insensitive" as const } })),
    },
  });

  return products.map((product) => ({
    product: {
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
    },
    viaSynonym: normalizeText(product.activeIngredient) !== normalizedIngredient,
  }));
}
