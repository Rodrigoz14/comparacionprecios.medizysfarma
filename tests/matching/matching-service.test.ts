import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { resolveCustomerRequestItem, resolveProductMatch } from "@/lib/matching/matching-service";
import { extractProductAttributes } from "@/lib/matching/extract-attributes";
import { buildGenericKey, buildNormalizedName, normalizeText } from "@/lib/matching/normalize";

// "Zoltraxina" es un principio activo ficticio usado solo en estas pruebas, para
// no depender de (ni contaminar) datos reales o los del seed.
async function createProduct(rawName: string, laboratoryName: string) {
  const extraction = extractProductAttributes(rawName)!;
  const laboratoryNormalizedName = normalizeText(laboratoryName);
  const laboratory = await prisma.laboratory.upsert({
    where: { normalizedName: laboratoryNormalizedName },
    update: {},
    create: { name: laboratoryName, normalizedName: laboratoryNormalizedName },
  });
  const normalizedName = buildNormalizedName(extraction.attributes, laboratoryNormalizedName);
  return prisma.product.create({
    data: {
      standardName: rawName,
      normalizedName,
      genericKey: buildGenericKey(extraction.attributes),
      activeIngredient: extraction.attributes.activeIngredient,
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

describe("resolveProductMatch (integracion contra base de datos real)", () => {
  const productIds: string[] = [];
  const laboratoryIds: string[] = [];

  beforeAll(async () => {
    const genfarVariant = await createProduct("ZOLTRAXINA TAB 100MG X30", "TestLab Genfar");
    const pfizerVariant = await createProduct("ZOLTRAXINA TAB 100MG X30", "TestLab Pfizer");
    const differentConcentration = await createProduct("ZOLTRAXINA TAB 200MG X30", "TestLab Genfar");
    const differentForm = await createProduct("ZOLTRAXINA CAPS 100MG X30", "TestLab Genfar");

    productIds.push(genfarVariant.id, pfizerVariant.id, differentConcentration.id, differentForm.id);
    laboratoryIds.push(genfarVariant.laboratoryId!, pfizerVariant.laboratoryId!);

    await prisma.ingredientSynonym.upsert({
      where: { term: "zoltraxinasal" },
      update: {},
      create: { term: "zoltraxinasal", canonicalTerm: "zoltraxina", source: "test" },
    });
  });

  afterAll(async () => {
    await prisma.customerRequestItem.deleteMany({ where: { matchedProductId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.laboratory.deleteMany({ where: { id: { in: laboratoryIds } } });
    await prisma.ingredientSynonym.deleteMany({ where: { term: "zoltraxinasal" } });
  });

  it("coincidencia exacta devuelve TODOS los laboratorios del mismo generico con confianza 1", async () => {
    const result = await resolveProductMatch("ZOLTRAXINA TAB 100MG X30");
    expect(result.decision).toBe("MATCH");
    expect(result.confidence).toBe(1);
    expect(result.matchedProductIds.sort()).toEqual([productIds[0], productIds[1]].sort());
    expect(result.source).toBe("deterministic");
  });

  it("nunca es MATCH cuando la concentracion es distinta, aunque el ingrediente coincida", async () => {
    const result = await resolveProductMatch("ZOLTRAXINA TAB 999MG X30");
    expect(result.decision).not.toBe("MATCH");
  });

  it("ingrediente desconocido sin candidatos -> NO_MATCH", async () => {
    const result = await resolveProductMatch("INGREDIENTEDESCONOCIDOXYZ TAB 100MG X30");
    expect(result.decision).toBe("NO_MATCH");
    expect(result.matchedProductIds).toEqual([]);
  });

  it("texto sin concentracion/presentacion reconocible -> NO_MATCH inmediato, sin consultar la base de datos", async () => {
    const result = await resolveProductMatch("PRODUCTO SIN DATOS CLAROS");
    expect(result.decision).toBe("NO_MATCH");
    expect(result.source).toBe("none");
  });

  it("presentacion distinta baja el puntaje por debajo del umbral de revision", async () => {
    const result = await resolveProductMatch("ZOLTRAXINA TAB 100MG X90");
    expect(result.decision).toBe("NO_MATCH");
    expect(result.confidence).toBeLessThan(0.8);
  });

  it("coincidencia via sinonimo de ingrediente no es MATCH automatico (queda para revision sin IA configurada)", async () => {
    const result = await resolveProductMatch("ZOLTRAXINASAL TAB 100MG X30");
    expect(result.decision).toBe("REVIEW");
    expect(result.confidence).toBeLessThan(1);
    expect(result.matchedProductIds).toEqual([]);
  });

  it("resolveCustomerRequestItem persiste la decision en el item de la solicitud", async () => {
    const customerRequest = await prisma.customerRequest.create({
      data: { customerName: "Cliente de prueba" },
    });
    const item = await prisma.customerRequestItem.create({
      data: {
        customerRequestId: customerRequest.id,
        originalText: "ZOLTRAXINA TAB 100MG X30",
        requestedQuantity: 10,
      },
    });

    const result = await resolveCustomerRequestItem(item.id);
    expect(result.decision).toBe("MATCH");

    const updated = await prisma.customerRequestItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.matchStatus).toBe("MATCH");
    expect(Number(updated.matchConfidence)).toBe(1);
    expect(updated.matchedProductId).not.toBeNull();

    await prisma.customerRequestItem.delete({ where: { id: item.id } });
    await prisma.customerRequest.delete({ where: { id: customerRequest.id } });
  });
});
