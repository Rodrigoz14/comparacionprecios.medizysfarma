import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Se simula el proveedor de IA (nunca una llamada real) para poder probar
// que resolveProductMatch efectivamente usa la sugerencia de la IA como
// último recurso, sin depender de una CLAUDE_API_KEY real ni de la
// variabilidad de una respuesta real del modelo. Este mock vive en un
// archivo aparte de matching-service.test.ts para no afectar las pruebas
// que ya asumen que la IA no responde (sin clave configurada).
vi.mock("@/lib/ai/provider", () => ({
  getAIProvider: vi.fn(),
}));

import { getAIProvider } from "@/lib/ai/provider";
import { prisma } from "@/lib/db/client";
import { extractProductAttributes } from "@/lib/matching/extract-attributes";
import { resolveProductMatch } from "@/lib/matching/matching-service";
import { buildGenericKey, buildNormalizedName, canonicalizeIngredient, normalizeText } from "@/lib/matching/normalize";

async function createProduct(rawName: string, laboratoryName: string) {
  const extraction = extractProductAttributes(rawName)!;
  const laboratoryNormalizedName = normalizeText(laboratoryName);
  const laboratory = await prisma.laboratory.upsert({
    where: { normalizedName: laboratoryNormalizedName },
    update: {},
    create: { name: laboratoryName, normalizedName: laboratoryNormalizedName },
  });
  return prisma.product.create({
    data: {
      standardName: rawName,
      normalizedName: buildNormalizedName(extraction.attributes, laboratoryNormalizedName),
      genericKey: buildGenericKey(extraction.attributes),
      activeIngredient: extraction.attributes.activeIngredient,
      ingredientKey: canonicalizeIngredient(extraction.attributes.activeIngredient),
      concentration: extraction.attributes.concentration,
      concentrationUnit: extraction.attributes.concentrationUnit,
      dosageForm: extraction.attributes.dosageForm,
      presentationType: extraction.attributes.presentationType,
      presentationQuantity: extraction.attributes.presentationQuantity,
      presentationUnit: extraction.attributes.presentationUnit,
      laboratoryId: laboratory.id,
    },
  });
}

function mockAIGuesses(...guesses: string[]) {
  vi.mocked(getAIProvider).mockReturnValue({
    name: "claude",
    complete: vi.fn().mockResolvedValue({
      text: JSON.stringify({ guesses }),
      provider: "claude",
      model: "test",
    }),
  });
}

// Bug real reportado por el cliente: "Perezoal" (garabateado, sin ninguna
// relación de tipeo/subconjunto con el nombre real) no encontraba nada con
// ninguna regla determinística -- la IA, con su conocimiento médico, sí
// puede sugerir a qué principio activo se refiere realmente.
describe("resolveProductMatch (respaldo con IA cuando nada mas encuentra nada)", () => {
  const productIds: string[] = [];
  const laboratoryIds: string[] = [];

  beforeAll(async () => {
    const product = await createProduct("ZOLTRAPENICILINA 500MG TABLETA X10", "TestLab Zoltrapenicilina");
    productIds.push(product.id);
    laboratoryIds.push(product.laboratoryId!);
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.laboratory.deleteMany({ where: { id: { in: laboratoryIds } } });
  });

  afterEach(() => {
    vi.mocked(getAIProvider).mockReset();
  });

  // Estas pruebas usan un texto (ficticio) que no coincide con nada por
  // ninguna regla determinística, así que cada una paga el costo real del
  // último nivel de búsqueda (nombre comercial: trae el catálogo activo
  // completo, ~11 mil productos) al menos una vez -- contra Neon (por red)
  // eso mide varios segundos en datos reales, más que el timeout por
  // defecto de la prueba. Se sube el timeout en vez de acortar el texto,
  // para seguir probando el caso real (texto totalmente irreconocible).

  it(
    "encuentra el producto real a partir de una sugerencia de la IA cuando nada mas encontro nada",
    async () => {
      mockAIGuesses("zoltrapenicilina");
      const result = await resolveProductMatch("Xyzqwertzoltra tableta");
      expect(result.decision).toBe("REVIEW");
      expect(result.source).toBe("ai");
      expect(result.matchedProductIds).toEqual([]);
      const foundIds = result.candidates.map((c) => c.product.id);
      expect(foundIds).toContain(productIds[0]);
      expect(result.reasons.join(" ")).toMatch(/la ia sugirió/i);
    },
    15000,
  );

  it(
    "prueba cada sugerencia de la IA en orden hasta encontrar una que exista en el catalogo",
    async () => {
      mockAIGuesses("ingredienteinventadoxyz", "zoltrapenicilina");
      const result = await resolveProductMatch("Xyzqwertzoltra tableta");
      const foundIds = result.candidates.map((c) => c.product.id);
      expect(foundIds).toContain(productIds[0]);
    },
    20000,
  );

  it(
    "sigue en NO_MATCH si ninguna sugerencia de la IA existe en el catalogo (nunca inventa)",
    async () => {
      mockAIGuesses("ingredienteinventadoxyz", "otroinventadoabc");
      const result = await resolveProductMatch("Xyzqwertzoltra tableta");
      expect(result.decision).toBe("NO_MATCH");
      expect(result.candidates).toEqual([]);
    },
    20000,
  );

  it(
    "no rompe la busqueda si la IA no esta configurada o falla (se comporta como sin IA)",
    async () => {
      vi.mocked(getAIProvider).mockReturnValue({
        name: "claude",
        complete: vi.fn().mockRejectedValue(new Error("CLAUDE_API_KEY no está configurada.")),
      });
      const result = await resolveProductMatch("Xyzqwertzoltra tableta");
      expect(result.decision).toBe("NO_MATCH");
    },
    15000,
  );
});
