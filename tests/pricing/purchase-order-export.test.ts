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
      data: { customerRequestId: request.id, originalText: "PEDIDOTEST TAB 500MG X10", requestedQuantity: 3 },
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
    // Fila 1 = encabezados, fila 2 = el producto. Piden 3 cajas x10 directamente.
    // Columna 1 = Cliente, 2 = código proveedor, 3 = producto, 4 = disponibilidad,
    // 5 = cubierto por bodega, 6 = laboratorio, 7 = presentación, 8 = empaques a pedir.
    expect(disfarmaSheet.getRow(2).getCell(1).value).toBe("Cliente Pedido Real"); // sin columna propia de cliente en el ítem, usa el de la solicitud
    expect(disfarmaSheet.getRow(2).getCell(8).value).toBe(3); // empaques a pedir
    expect(disfarmaSheet.getRow(2).getCell(2).value).toBe("DIS-001");
    expect(disfarmaSheet.getRow(2).getCell(4).value).toBe("Disponible: 500 unidades"); // disponibilidad, textual y numérica
    expect(disfarmaSheet.getRow(2).getCell(5).value).toBe(0); // nada cubierto por bodega en este caso
  });

  it("agrega una pestaña 'Bodega' con lo cubierto por existencia propia, completo o en parte", async () => {
    const request = await prisma.customerRequest.create({ data: { customerName: "Cliente Pedido Bodega" } });
    requestIds.push(request.id);

    // productA (PEDIDOTEST) pide 5, bodega solo cubre 2 -> quedan 3 por comprar.
    await prisma.warehouseStock.create({ data: { genericKey: genericKeys[0], quantity: 2 } });
    const itemA = await prisma.customerRequestItem.create({
      data: { customerRequestId: request.id, originalText: "PEDIDOTEST TAB 500MG X10", requestedQuantity: 5 },
    });
    await resolveCustomerRequestItem(itemA.id);
    await selectBestOffer(itemA.id);

    const result = await buildPurchaseOrderWorkbook(request.id);
    expect(result).not.toBeNull();

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result!.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

    const warehouseSheet = workbook.getWorksheet("Bodega")!;
    expect(warehouseSheet).toBeDefined();
    expect(warehouseSheet.getRow(2).getCell(1).value).toBe("Cliente Pedido Bodega");
    expect(warehouseSheet.getRow(2).getCell(3).value).toBe(5); // cantidad pedida
    expect(warehouseSheet.getRow(2).getCell(4).value).toBe(2); // cubierto por bodega
    expect(warehouseSheet.getRow(2).getCell(5).value).toBe(3); // pendiente por comprar

    // Lo pendiente (3) sí debe seguir apareciendo en la hoja del proveedor,
    // con la cantidad cubierta por bodega repetida ahí tambien (columna 5).
    const disfarmaSheet = workbook.getWorksheet("Disfarma Test Pedido")!;
    expect(disfarmaSheet.getRow(2).getCell(8).value).toBe(3);
    expect(disfarmaSheet.getRow(2).getCell(5).value).toBe(2);

    await prisma.warehouseStock.deleteMany({ where: { genericKey: genericKeys[0] } });
  });

  it("agrega una pestaña 'Sin disponibilidad' cuando ningun proveedor alcanza, con una fila por alternativa comparada", async () => {
    const request = await prisma.customerRequest.create({ data: { customerName: "Cliente Pedido Insuficiente" } });
    requestIds.push(request.id);

    // Ambas ofertas de PEDIDOTEST2 (Ramedicas) quedan con stock insuficiente
    // para las 20 unidades pedidas -- ninguna alternativa queda "selected".
    await prisma.supplierOffer.updateMany({
      where: { productId: productIds[1] },
      data: { stockQuantity: 3 },
    });

    const itemB = await prisma.customerRequestItem.create({
      data: { customerRequestId: request.id, originalText: "PEDIDOTEST2 JBE 100MG X1", requestedQuantity: 20 },
    });
    await resolveCustomerRequestItem(itemB.id);
    const selection = await selectBestOffer(itemB.id);
    expect(selection.status).toBe("NO_STOCK");

    const result = await buildPurchaseOrderWorkbook(request.id);
    expect(result).not.toBeNull();

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result!.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

    // No debe aparecer ninguna hoja de proveedor para este producto -- nunca
    // hubo nada "selected" que comprarle.
    expect(workbook.worksheets.map((s) => s.name)).not.toContain("Ramedicas Test Pedido");

    const unavailableSheet = workbook.getWorksheet("Sin disponibilidad")!;
    expect(unavailableSheet).toBeDefined();
    expect(unavailableSheet.getRow(2).getCell(1).value).toBe("Cliente Pedido Insuficiente");
    expect(unavailableSheet.getRow(2).getCell(3).value).toBe("Ramedicas Test Pedido");
    expect(unavailableSheet.getRow(2).getCell(4).value).toBe("Existencia insuficiente: 3 disponibles, se solicitan 20.");
    expect(unavailableSheet.getRow(2).getCell(7).value).toBe(20); // pendiente por comprar

    await prisma.supplierOffer.updateMany({ where: { productId: productIds[1] }, data: { stockQuantity: 500 } });
  });

  it("un producto excluido manualmente no aparece en 'Sin disponibilidad' ni en ninguna hoja (bug real, 2026-10-07: antes era indistinguible de NO_STOCK)", async () => {
    const request = await prisma.customerRequest.create({ data: { customerName: "Cliente Pedido Excluido" } });
    requestIds.push(request.id);

    // Mismo escenario sin existencia suficiente que la prueba anterior, pero
    // esta vez el usuario decide explícitamente no comprarlo (equivalente a
    // /exclude-offer), no es el motor el que descartó todas las ofertas.
    await prisma.supplierOffer.updateMany({
      where: { productId: productIds[1] },
      data: { stockQuantity: 3 },
    });

    const itemB = await prisma.customerRequestItem.create({
      data: { customerRequestId: request.id, originalText: "PEDIDOTEST2 JBE 100MG X1", requestedQuantity: 20 },
    });
    await resolveCustomerRequestItem(itemB.id);
    const selection = await selectBestOffer(itemB.id);
    expect(selection.status).toBe("NO_STOCK");
    await prisma.customerRequestItem.update({ where: { id: itemB.id }, data: { excludedManually: true } });

    const result = await buildPurchaseOrderWorkbook(request.id);
    // Era el único ítem de esta solicitud y quedó excluido: no hay nada que
    // mostrar, ni en una hoja de proveedor ni en "Sin disponibilidad".
    expect(result).toBeNull();

    await prisma.supplierOffer.updateMany({ where: { productId: productIds[1] }, data: { stockQuantity: 500 } });
  });
});
