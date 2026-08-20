import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { resolveCustomerRequestItem, resolveProductMatch } from "@/lib/matching/matching-service";
import { extractProductAttributes } from "@/lib/matching/extract-attributes";
import { buildGenericKey, buildNormalizedName, canonicalizeIngredient, normalizeText } from "@/lib/matching/normalize";

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

  it("presentacion distinta sigue siendo MATCH: mismo generico, se compara por unidad en el motor de precios", async () => {
    const result = await resolveProductMatch("ZOLTRAXINA TAB 100MG X90");
    expect(result.decision).toBe("MATCH");
    expect(result.confidence).toBe(1);
    expect(result.matchedProductIds.sort()).toEqual([productIds[0], productIds[1]].sort());
  });

  it("un cliente puede buscar sin indicar presentacion: la cantidad va en un campo aparte", async () => {
    const result = await resolveProductMatch("ZOLTRAXINA TAB 100MG");
    expect(result.decision).toBe("MATCH");
    expect(result.confidence).toBe(1);
    expect(result.matchedProductIds.sort()).toEqual([productIds[0], productIds[1]].sort());
  });

  it("sin forma farmaceutica y con varias disponibles a la misma concentracion -> REVIEW, nunca NO_MATCH ni una eleccion a ciegas", async () => {
    // Bug real reportado por el cliente: "Acido Valproico 250mg" (sin decir
    // capsula/jarabe/tableta) caia en NO_MATCH aunque el producto existiera,
    // porque el puntaje por la forma farmaceutica ausente hundia el total
    // por debajo del umbral de revision. A 100mg este fixture tiene Tableta
    // (dos laboratorios) y Capsula, asi que es un caso realmente ambiguo.
    const result = await resolveProductMatch("ZOLTRAXINA 100MG");
    expect(result.decision).toBe("REVIEW");
    expect(result.matchedProductIds).toEqual([]);
    expect(result.reasons.join(" ")).toMatch(/forma farmac[ée]utica/i);
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

// Caso real reportado por el cliente: Ramedicas escribe "VALPROICO ACIDO"
// (alfabetizado) y Disfarma "ACIDO VALPROICO" (orden natural) para la misma
// sustancia; sin canonicalizar el orden de las palabras, ni la busqueda del
// cliente ni la comparacion de precios entre proveedores encontraban match.
describe("resolveProductMatch (orden de palabras del ingrediente activo)", () => {
  const productIds: string[] = [];
  const laboratoryIds: string[] = [];

  beforeAll(async () => {
    // "ZOLTRAXINICO ACIDO", orden alfabetizado como en los archivos de Ramedicas.
    const ramedicasStyle = await createProduct("ZOLTRAXINICO ACIDO 250MG CAPSULA X30", "TestLab Ramedicas Style");
    productIds.push(ramedicasStyle.id);
    laboratoryIds.push(ramedicasStyle.laboratoryId!);
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.laboratory.deleteMany({ where: { id: { in: laboratoryIds } } });
  });

  it("encuentra el producto sin importar el orden de las palabras del ingrediente", async () => {
    const result = await resolveProductMatch("ACIDO ZOLTRAXINICO 250MG CAPSULA X30");
    expect(result.decision).toBe("MATCH");
    expect(result.confidence).toBe(1);
    expect(result.matchedProductIds).toEqual([productIds[0]]);
  });

  it("combina ambas correcciones: sin presentacion y con el ingrediente en orden natural", async () => {
    const result = await resolveProductMatch("ACIDO ZOLTRAXINICO 250MG CAPSULA");
    expect(result.decision).toBe("MATCH");
    expect(result.matchedProductIds).toEqual([productIds[0]]);
  });

  it("sin forma farmaceutica pero con una sola disponible -> MATCH automatico, no hay ambiguedad real", async () => {
    const result = await resolveProductMatch("ACIDO ZOLTRAXINICO 250MG");
    expect(result.decision).toBe("MATCH");
    expect(result.matchedProductIds).toEqual([productIds[0]]);
  });
});

// Caso real reportado por el cliente: buscar "acido valprico" (typo, falta una
// letra) en vez de "acido valproico" no encontraba nada. La tolerancia a
// errores de tipeo nunca debe auto-confirmar: solo amplía qué se muestra para
// que un humano confirme, porque una sustancia distinta con nombre parecido
// no es intercambiable (a diferencia del orden de palabras o la presentación).
describe("resolveProductMatch (tolerancia a errores de tipeo en el ingrediente)", () => {
  const productIds: string[] = [];
  const laboratoryIds: string[] = [];

  beforeAll(async () => {
    const product = await createProduct("ZOLTRAXOLIDINA 250MG TABLETA X30", "TestLab Zoltraxolidina");
    productIds.push(product.id);
    laboratoryIds.push(product.laboratoryId!);
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.laboratory.deleteMany({ where: { id: { in: laboratoryIds } } });
  });

  it("un typo de una letra encuentra el candidato pero nunca hace MATCH automatico", async () => {
    const result = await resolveProductMatch("ZOLTRAXOLIDNA 250MG TABLETA X30");
    expect(result.decision).toBe("REVIEW");
    expect(result.matchedProductIds).toEqual([]);
    expect(result.candidates.map((c) => c.product.id)).toContain(productIds[0]);
    expect(result.reasons.join(" ")).toMatch(/error de tipeo/i);
  });

  it("un ingrediente totalmente distinto no encuentra nada por mas tolerancia que se de", async () => {
    // Ficticio y muy distinto a cualquier ingrediente real del catalogo, para
    // no depender de qué productos reales existan en la base de datos compartida.
    const result = await resolveProductMatch("INGREDIENTEDESCONOCIDOPQZ 250MG TABLETA X30");
    expect(result.decision).toBe("NO_MATCH");
    expect(result.matchedProductIds).toEqual([]);
  });
});
