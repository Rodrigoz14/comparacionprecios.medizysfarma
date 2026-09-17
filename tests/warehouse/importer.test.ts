import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { importWarehouseStock } from "@/lib/warehouse/importer";
import { buildGenericKey, buildNormalizedName, canonicalizeIngredient, normalizeText } from "@/lib/matching/normalize";
import { extractProductAttributes } from "@/lib/matching/extract-attributes";

async function buildXlsxBuffer(rows: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Bodega");
  for (const row of rows) sheet.addRow(row);
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

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

describe("importWarehouseStock (integracion contra base de datos real)", () => {
  const productIds: string[] = [];
  const laboratoryIds: string[] = [];
  const genericKeys: string[] = [];

  beforeAll(async () => {
    const genfar = await createProduct("BODEGAIMPORT TAB 250MG X20", "TestLab Bodega Import Genfar");
    const pfizer = await createProduct("BODEGAIMPORT TAB 250MG X20", "TestLab Bodega Import Pfizer");
    productIds.push(genfar.id, pfizer.id);
    laboratoryIds.push(genfar.laboratoryId!, pfizer.laboratoryId!);
    genericKeys.push(genfar.genericKey);
  });

  afterAll(async () => {
    await prisma.warehouseStock.deleteMany({ where: { genericKey: { in: genericKeys } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.laboratory.deleteMany({ where: { id: { in: laboratoryIds } } });
  });

  it("suma cantidades de filas distintas que caen en el mismo generico, y reporta filas no identificadas", async () => {
    const buffer = await buildXlsxBuffer([
      ["Producto", "Cantidad"],
      ["BODEGAIMPORT TAB 250MG X20", 15], // genfar, homologa por generico
      ["BODEGAIMPORT TAB 250MG X20", 25], // pfizer, mismo generico -> suma
      ["INGREDIENTEDESCONOCIDOXYZ TAB 999MG X1", 5], // no deberia homologar
    ]);

    const report = await importWarehouseStock(buffer, "bodega-test.xlsx");

    expect(report.totalRows).toBe(3);
    expect(report.matchedRows).toBe(2);
    expect(report.unmatchedRows).toBe(1);
    expect(report.distinctProducts).toBe(1);
    expect(report.errors[0].text).toContain("INGREDIENTEDESCONOCIDOXYZ");

    const stock = await prisma.warehouseStock.findUnique({ where: { genericKey: genericKeys[0] } });
    expect(stock?.quantity).toBe(40); // 15 + 25
  });

  it("una nueva importacion reemplaza el inventario anterior por completo", async () => {
    const buffer = await buildXlsxBuffer([
      ["Producto", "Cantidad"],
      ["BODEGAIMPORT TAB 250MG X20", 5],
    ]);

    await importWarehouseStock(buffer, "bodega-test-2.xlsx");

    const stock = await prisma.warehouseStock.findUnique({ where: { genericKey: genericKeys[0] } });
    expect(stock?.quantity).toBe(5); // no 45 -- se reemplazo, no se sumo sobre la importacion anterior

    const allStock = await prisma.warehouseStock.findMany();
    expect(allStock.length).toBe(1); // el inventario global quedo reemplazado, no acumulado
  });

  // Bug real: un Kardex de bodega trae un título y una fecha antes del
  // encabezado real -- el detector solo miraba la fila 0 y nunca encontraba
  // el encabezado, así que el título y la fecha se importaban como si fueran
  // filas de producto. Además, las existencias en 0 (muy comunes en un
  // Kardex real) no se reconocían como cantidad válida.
  it("ignora filas de titulo/fecha antes del encabezado real y reconoce existencias en cero", async () => {
    const buffer = await buildXlsxBuffer([
      ["Rotación Kardex"],
      ["Fecha I", "1/01/2026"],
      ["Código", "Nombre Articulo", "Saldo Fin"],
      ["ME0001", "BODEGAIMPORT TAB 250MG X20", 0],
      ["ME0002", "INGREDIENTEDESCONOCIDOXYZ TAB 999MG X1", 0],
    ]);

    const report = await importWarehouseStock(buffer, "kardex-test.xlsx");

    expect(report.totalRows).toBe(2); // no cuenta el título ni la fecha como filas
    expect(report.matchedRows).toBe(1);
    expect(report.errors[0].text).toContain("INGREDIENTEDESCONOCIDOXYZ");

    const stock = await prisma.warehouseStock.findUnique({ where: { genericKey: genericKeys[0] } });
    expect(stock?.quantity).toBe(0);
  });
});
