import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { resolveCustomerRequestItem } from "@/lib/matching/matching-service";
import { selectBestOffer } from "@/lib/pricing/selection-engine";
import { buildPurchaseOrderWorkbook } from "@/lib/pricing/purchase-order-export";
import { buildGenericKey, buildNormalizedName, canonicalizeIngredient, normalizeText } from "@/lib/matching/normalize";
import { extractProductAttributes } from "@/lib/matching/extract-attributes";

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

describe("buildPurchaseOrderWorkbook (integracion contra base de datos real)", () => {
  const productIds: string[] = [];
  const laboratoryIds: string[] = [];
  const supplierIds: string[] = [];
  const requestIds: string[] = [];
  const genericKeys: string[] = [];

  beforeAll(async () => {
    const productA = await createProduct("PEDIDOTEST TAB 500MG X10", "TestLab Pedido A");
    const productB = await createProduct("PEDIDOTEST2 JBE 100MG X1", "TestLab Pedido B");
    productIds.push(productA.id, productB.id);
    laboratoryIds.push(productA.laboratoryId!, productB.laboratoryId!);
    genericKeys.push(productA.genericKey, productB.genericKey);

    const disfarma = await prisma.supplier.create({ data: { name: "Disfarma Test Pedido" } });
    const ramedicas = await prisma.supplier.create({ data: { name: "Ramedicas Test Pedido" } });
    supplierIds.push(disfarma.id, ramedicas.id);

    await prisma.supplierOffer.create({
      data: { supplierId: disfarma.id, productId: productA.id, price: 4000, availability: "AVAILABLE", stockQuantity: 500, supplierProductCode: "DIS-001" },
    });
    await prisma.supplierOffer.create({
      data: { supplierId: ramedicas.id, productId: productB.id, price: 2000, availability: "AVAILABLE", stockQuantity: 500, supplierProductCode: "RAM-002" },
    });
  });

  afterAll(async () => {
    await prisma.warehouseStock.deleteMany({ where: { genericKey: { in: genericKeys } } });
    await prisma.priceComparison.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.customerRequestItem.deleteMany({ where: { customerRequestId: { in: requestIds } } });
    await prisma.customerRequest.deleteMany({ where: { id: { in: requestIds } } });
    await prisma.supplierOffer.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.laboratory.deleteMany({ where: { id: { in: laboratoryIds } } });
  });

  it("devuelve null cuando no hay nada seleccionado para comprar", async () => {
    const request = await prisma.customerRequest.create({ data: { customerName: "Cliente Pedido Vacio" } });
    requestIds.push(request.id);

    const result = await buildPurchaseOrderWorkbook(request.id);
    expect(result).toBeNull();
  });

  it("genera una hoja por proveedor con los productos y cantidades seleccionadas", async () => {
    const request = await prisma.customerRequest.create({ data: { customerName: "Cliente Pedido Real" } });
    requestIds.push(request.id);

    const itemA = await prisma.customerRequestItem.create({
      data: { customerRequestId: request.id, originalText: "PEDIDOTEST TAB 500MG X10", requestedQuantity: 25 },
    });
    const itemB = await prisma.customerRequestItem.create({
      data: { customerRequestId: request.id, originalText: "PEDIDOTEST2 JBE 100MG X1", requestedQuantity: 8 },
    });

    await resolveCustomerRequestItem(itemA.id);
    await selectBestOffer(itemA.id);
    await resolveCustomerRequestItem(itemB.id);
    await selectBestOffer(itemB.id);

    const result = await buildPurchaseOrderWorkbook(request.id);
    expect(result).not.toBeNull();
    expect(result!.fileName).toContain("Cliente Pedido Real");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result!.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

    const sheetNames = workbook.worksheets.map((s) => s.name);
    expect(sheetNames).toContain("Resumen");
    expect(sheetNames).toContain("Disfarma Test Pedido");
    expect(sheetNames).toContain("Ramedicas Test Pedido");

    const disfarmaSheet = workbook.getWorksheet("Disfarma Test Pedido")!;
    // Fila 1 = encabezados, fila 2 = el producto. 3 cajas x10 = 30 >= 25 pedidas.
    expect(disfarmaSheet.getRow(2).getCell(5).value).toBe(3); // empaques a pedir
    expect(disfarmaSheet.getRow(2).getCell(1).value).toBe("DIS-001");
  });
});
