import { prisma } from "@/lib/db/client";

/**
 * Devuelve el término canónico y todos sus sinónimos conocidos (incluyéndose a
 * sí mismo), a partir del catálogo controlado `IngredientSynonym`. Nunca infiere
 * equivalencias por similitud de texto: solo usa lo que está explícitamente
 * registrado con una fuente.
 */
export async function expandIngredientTerms(normalizedIngredient: string): Promise<string[]> {
  const asSynonym = await prisma.ingredientSynonym.findUnique({
    where: { term: normalizedIngredient },
  });
  const canonical = asSynonym?.canonicalTerm ?? normalizedIngredient;

  const allSynonyms = await prisma.ingredientSynonym.findMany({
    where: { canonicalTerm: canonical },
  });

  return [...new Set([canonical, normalizedIngredient, ...allSynonyms.map((s) => s.term)])];
}
