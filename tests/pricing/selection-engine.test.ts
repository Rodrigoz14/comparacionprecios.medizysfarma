import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { resolveCustomerRequestItem } from "@/lib/matching/matching-service";
import { selectBestOffer } from "@/lib/pricing/selection-engine";
import { extractProductAttributes } from "@/lib/matching/extract-attributes";
import { buildGenericKey, buildNormalizedName, normalizeText } from "@/lib/matching/normalize";

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

async function createRequestItem(text: string, quantity: number) {
  const request = await prisma.customerRequest.create({ data: { customerName: "Cliente de prueba precios" } });
  const item = await prisma.customerRequestItem.create({
    data: { customerRequestId: request.id, originalText: text, requestedQuantity: quantity },
  });
  return { requestId: request.id, itemId: item.id };
}

describe("selectBestOffer (integracion contra base de datos real)", () => {
  it("elige el precio mas bajo entre laboratorios distintos del mismo generico (datos del seed)", async () => {
    const { itemId } = await createRequestItem("ACETAMINOFEN TAB 500MG X100", 10);
    await resolveCustomerRequestItem(itemId);

    const result = await selectBestOffer(itemId);

    expect(result.status).toBe("SELECTED");
    expect(result.selected?.unitPrice).toBe(5000); // Ramedicas + Genfar, el mas barato del seed
    expect(result.totalPrice).toBe(50000);
    expect(result.alternatives.length).toBeGreaterThanOrEqual(3); // Ramedicas/Genfar, Ramedicas/Pfizer, Disfarma/Genfar

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

  describe("con productos aislados de prueba", () => {
    const productIds: string[] = [];
    const laboratoryIds: string[] = [];
    const supplierIds: string[] = [];

    beforeAll(async () => {
      const productA = await createProduct("PRICETEST TAB 50MG X10", "TestLab Uno");
      productIds.push(productA.id);
      laboratoryIds.push(productA.laboratoryId!);

      const supplierX = await prisma.supplier.create({ data: { name: "Proveedor Precio Test X" } });
      const supplierY = await prisma.supplier.create({ data: { name: "Proveedor Precio Test Y" } });
      supplierIds.push(supplierX.id, supplierY.id);

      await prisma.supplierOffer.create({
        data: {
          supplierId: supplierX.id,
          productId: productA.id,
          price: 1000,
          availability: "OUT_OF_STOCK",
          stockQuantity: 0,
        },
      });
      await prisma.supplierOffer.create({
        data: {
          supplierId: supplierY.id,
          productId: productA.id,
          price: 1500,
          availability: "AVAILABLE",
          stockQuantity: 2, // menos que lo solicitado (10) en el test de abajo
        },
      });
    });

    afterAll(async () => {
      await prisma.priceComparison.deleteMany({ where: { productId: { in: productIds } } });
      await prisma.supplierOffer.deleteMany({ where: { productId: { in: productIds } } });
      await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
      await prisma.laboratory.deleteMany({ where: { id: { in: laboratoryIds } } });
    });

    it("NO_STOCK cuando ninguna oferta tiene existencia suficiente", async () => {
      const { itemId } = await createRequestItem("PRICETEST TAB 50MG X10", 10);
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
});
