import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { resolveCustomerRequestItem } from "@/lib/matching/matching-service";
import { selectBestOffer } from "@/lib/pricing/selection-engine";
import { extractProductAttributes } from "@/lib/matching/extract-attributes";
import { buildGenericKey, buildNormalizedName, canonicalizeIngredient, normalizeText } from "@/lib/matching/normalize";

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

async function createRequestItem(text: string, quantity: number) {
  const request = await prisma.customerRequest.create({ data: { customerName: "Cliente de prueba precios" } });
  const item = await prisma.customerRequestItem.create({
    data: { customerRequestId: request.id, originalText: text, requestedQuantity: quantity },
  });
  return { requestId: request.id, itemId: item.id };
}

// Fixtures propios en vez de datos del seed: el seed comparte el mismo espacio
// de nombres normalizados que los datos reales importados de proveedores, así
// que un producto "de ejemplo" puede terminar con precios reales encima.
describe("selectBestOffer (integracion contra base de datos real)", () => {
  const productIds: string[] = [];
  const laboratoryIds: string[] = [];
  const supplierIds: string[] = [];

  beforeAll(async () => {
    const genfarVariant = await createProduct("PRICETEST TAB 50MG X10", "TestLab Genfar Precio");
    const pfizerVariant = await createProduct("PRICETEST TAB 50MG X10", "TestLab Pfizer Precio");
    productIds.push(genfarVariant.id, pfizerVariant.id);
    laboratoryIds.push(genfarVariant.laboratoryId!, pfizerVariant.laboratoryId!);

    const supplierX = await prisma.supplier.create({ data: { name: "Proveedor Precio Test X" } });
    const supplierY = await prisma.supplier.create({ data: { name: "Proveedor Precio Test Y" } });
    supplierIds.push(supplierX.id, supplierY.id);

    // X ofrece ambos laboratorios: el generico (Genfar) mas barato que el de marca (Pfizer).
    await prisma.supplierOffer.create({
      data: { supplierId: supplierX.id, productId: genfarVariant.id, price: 5000, availability: "AVAILABLE", stockQuantity: 200 },
    });
    await prisma.supplierOffer.create({
      data: { supplierId: supplierX.id, productId: pfizerVariant.id, price: 20000, availability: "AVAILABLE", stockQuantity: 50 },
    });
    // Y tambien ofrece el generico, un poco mas caro que X.
    await prisma.supplierOffer.create({
      data: { supplierId: supplierY.id, productId: genfarVariant.id, price: 5300, availability: "AVAILABLE", stockQuantity: 80 },
    });
  });

  afterAll(async () => {
    await prisma.priceComparison.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.supplierOffer.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.laboratory.deleteMany({ where: { id: { in: laboratoryIds } } });
  });

  it("elige el precio mas bajo entre laboratorios distintos del mismo generico", async () => {
    const { itemId } = await createRequestItem("PRICETEST TAB 50MG X10", 10);
    await resolveCustomerRequestItem(itemId);

    const result = await selectBestOffer(itemId);

    expect(result.status).toBe("SELECTED");
    expect(result.selected?.supplierId).toBe(supplierIds[0]); // Proveedor X + Genfar, el mas barato
    expect(result.selected?.packagePrice).toBe(5000);
    expect(result.selected?.packagesNeeded).toBe(1); // 10 solicitadas, caja x10
    expect(result.totalPrice).toBe(5000);
    expect(result.alternatives.length).toBeGreaterThanOrEqual(3); // X/Genfar, X/Pfizer, Y/Genfar

    const persisted = await prisma.priceComparison.findMany({ where: { customerRequestItemId: itemId } });
    expect(persisted.length).toBe(result.alternatives.length);
    expect(persisted.filter((p) => p.selected).length).toBe(1);
  });

  it("NOT_FOUND cuando la homologacion no encontro el producto", async () => {
    const { itemId } = await createRequestItem("INGREDIENTEDESCONOCIDOXYZ TAB 100MG X30", 5);
    await resolveCustomerRequestItem(itemId);

    const result = await selectBestOffer(itemId);
    expect(result.status).toBe("NOT_FOUND");
    expect(result.selected).toBeNull();
  });

  it("NO_STOCK cuando ninguna oferta tiene existencia suficiente", async () => {
    const { itemId } = await createRequestItem("PRICETEST TAB 50MG X10", 500); // supera el stock de ambos proveedores
    await resolveCustomerRequestItem(itemId);

    const result = await selectBestOffer(itemId);
    expect(result.status).toBe("NO_STOCK");
    expect(result.selected).toBeNull();
    expect(result.alternatives.every((a) => !a.eligible)).toBe(true);
  });

  it("REVIEW cuando el item aun no fue homologado (MatchStatus PENDING)", async () => {
    const { itemId } = await createRequestItem("PRICETEST TAB 50MG X10", 1);
    // No se llama a resolveCustomerRequestItem: el item queda en PENDING.
    const result = await selectBestOffer(itemId);
    expect(result.status).toBe("REVIEW");
    expect(result.selected).toBeNull();
  });
});

// Caso real reportado por el cliente: Sildenafil 100mg en caja x30 (Ramedicas)
// vs caja x100 (Disfarma) — deben compararse por costo total para cubrir lo
// pedido, no descartarse entre si por tener presentaciones distintas.
describe("selectBestOffer (comparacion entre presentaciones distintas del mismo generico)", () => {
  const productIds: string[] = [];
  const laboratoryIds: string[] = [];
  const supplierIds: string[] = [];

  beforeAll(async () => {
    const caja30 = await createProduct("ZOLTRAXINA TAB 100MG X30", "TestLab Zoltraxina");
    const caja100 = await createProduct("ZOLTRAXINA TAB 100MG X100", "TestLab Zoltraxina");
    productIds.push(caja30.id, caja100.id);
    laboratoryIds.push(caja30.laboratoryId!, caja100.laboratoryId!);
    expect(caja30.genericKey).toBe(caja100.genericKey); // misma clave generica pese a distinta presentacion

    const ramedicas = await prisma.supplier.create({ data: { name: "Ramedicas Test Zoltraxina" } });
    const disfarma = await prisma.supplier.create({ data: { name: "Disfarma Test Zoltraxina" } });
    supplierIds.push(ramedicas.id, disfarma.id);

    // Ramedicas: caja x30 a $9000 -> $300/unidad. Disfarma: caja x100 a $25000 -> $250/unidad.
    await prisma.supplierOffer.create({
      data: { supplierId: ramedicas.id, productId: caja30.id, price: 9000, availability: "AVAILABLE", stockQuantity: 300 },
    });
    await prisma.supplierOffer.create({
      data: { supplierId: disfarma.id, productId: caja100.id, price: 25000, availability: "AVAILABLE", stockQuantity: 500 },
    });
  });

  afterAll(async () => {
    await prisma.priceComparison.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.supplierOffer.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.laboratory.deleteMany({ where: { id: { in: laboratoryIds } } });
  });

  it("para un pedido pequeno, gana la presentacion mas chica aunque su precio unitario sea mas alto", async () => {
    // Piden 30: Ramedicas cubre con 1 caja x30 ($9000). Disfarma necesita 1 caja x100 igual ($25000).
    const { itemId } = await createRequestItem("ZOLTRAXINA TAB 100MG X30", 30);
    await resolveCustomerRequestItem(itemId);

    const result = await selectBestOffer(itemId);
    expect(result.status).toBe("SELECTED");
    expect(result.selected?.supplierName).toBe("Ramedicas Test Zoltraxina");
    expect(result.selected?.unitPrice).toBeGreaterThan(
      result.alternatives.find((a) => a.supplierName === "Disfarma Test Zoltraxina")!.unitPrice,
    );
    expect(result.totalPrice).toBe(9000);
  });

  it("para un pedido grande, gana la presentacion que minimiza empaques desperdiciados", async () => {
    // Piden 90: Ramedicas necesita 3 cajas x30 (3*9000=27000). Disfarma cubre con 1 caja x100 (25000).
    const { itemId } = await createRequestItem("ZOLTRAXINA TAB 100MG X30", 90);
    await resolveCustomerRequestItem(itemId);

    const result = await selectBestOffer(itemId);
    expect(result.status).toBe("SELECTED");
    expect(result.selected?.supplierName).toBe("Disfarma Test Zoltraxina");
    expect(result.selected?.packagesNeeded).toBe(1);
    expect(result.totalPrice).toBe(25000);
  });
});
