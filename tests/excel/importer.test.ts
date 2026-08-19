import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { analyzeSupplierFile, confirmSupplierImport } from "@/lib/excel/importer";
import type { ColumnMapping, PriceFormat } from "@/lib/excel/types";

async function buildXlsxBuffer(rows: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Precios");
  for (const row of rows) sheet.addRow(row);
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

const HEADER = ["CODIGO", "DESCRIPCION", "LABORATORIO", "PRECIO", "EXISTENCIA"];

const BASE_ROWS = [
  HEADER,
  ["T001", "IBUPROFENO TAB 400MG X30", "MK", "8.200", "20"],
  ["T001", "IBUPROFENO TAB 400MG X30", "MK", "8.500", "20"], // duplicado con precio distinto
  ["T002", "LORATADINA TAB 10MG X10", "MK", "3.000", "SI"],
  ["T003", "", "MK", "5.000", "SI"], // sin nombre de producto -> error
];

describe("importador de Excel (integracion contra base de datos real)", () => {
  let supplierId: string;
  let baseBuffer: Buffer;

  beforeAll(async () => {
    const supplier = await prisma.supplier.create({
      data: { name: `Proveedor Test Importador ${Date.now()}` },
    });
    supplierId = supplier.id;
    baseBuffer = await buildXlsxBuffer(BASE_ROWS);
  });

  afterAll(async () => {
    const offers = await prisma.supplierOffer.findMany({ where: { supplierId }, select: { id: true, productId: true } });
    const offerIds = offers.map((o) => o.id);
    const productIds = offers.map((o) => o.productId);

    await prisma.priceHistory.deleteMany({ where: { supplierOfferId: { in: offerIds } } });
    await prisma.supplierOffer.deleteMany({ where: { supplierId } });
    await prisma.supplierFile.deleteMany({ where: { supplierId } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.supplier.delete({ where: { id: supplierId } });
  });

  it("analiza el archivo y propone el mapeo de columnas correcto", async () => {
    const result = await analyzeSupplierFile(baseBuffer, "test-ramedicas.xlsx", supplierId);

    expect(result.alreadyImported).toBeNull();
    const byTarget = Object.fromEntries(result.columns.map((c) => [c.proposedTarget, c.index]));
    expect(byTarget.productName).toBe(1);
    expect(byTarget.price).toBe(3);
  });

  it("importa las filas validas, agrupa duplicados y reporta errores", async () => {
    const analysis = await analyzeSupplierFile(baseBuffer, "test-ramedicas.xlsx", supplierId);

    const mapping: ColumnMapping = {};
    for (const col of analysis.columns) if (col.proposedTarget) mapping[col.proposedTarget] = col.index;
    const priceFormat: PriceFormat = { thousands: ".", decimal: "," };

    const report = await confirmSupplierImport({
      fileToken: analysis.fileToken,
      supplierId,
      sheetName: analysis.selectedSheet,
      headerRowIndex: analysis.headerRowIndex,
      mapping,
      priceFormat,
    });

    expect(report.totalRows).toBe(4);
    expect(report.errorRows).toBe(1);
    expect(report.importedRows).toBe(2); // ibuprofeno (deduplicado) + loratadina
    expect(report.newProducts).toBe(2);
    expect(report.warningRows).toBeGreaterThan(0);

    const offer = await prisma.supplierOffer.findFirst({
      where: { supplierId, product: { normalizedName: { contains: "ibuprofeno" } } },
    });
    expect(offer).not.toBeNull();
    expect(Number(offer!.price)).toBe(8500); // se conserva la ultima aparicion del duplicado
  });

  it("rechaza reimportar el mismo archivo sin 'force'", async () => {
    const analysis = await analyzeSupplierFile(baseBuffer, "test-ramedicas.xlsx", supplierId);
    expect(analysis.alreadyImported).not.toBeNull();

    const mapping: ColumnMapping = {};
    for (const col of analysis.columns) if (col.proposedTarget) mapping[col.proposedTarget] = col.index;

    await expect(
      confirmSupplierImport({
        fileToken: analysis.fileToken,
        supplierId,
        sheetName: analysis.selectedSheet,
        headerRowIndex: analysis.headerRowIndex,
        mapping,
        priceFormat: { thousands: ".", decimal: "," },
      }),
    ).rejects.toThrow(/ya fue importado/);
  });

  it("al reimportar con un precio distinto, actualiza la oferta y conserva el historial", async () => {
    const updatedRows = BASE_ROWS.map((row) => [...row]);
    // BASE_ROWS[2] es la fila que "gana" la deduplicación (última aparición de T001).
    updatedRows[2] = ["T001", "IBUPROFENO TAB 400MG X30", "MK", "9.000", "20"];
    const buffer = await buildXlsxBuffer(updatedRows);
    const analysis = await analyzeSupplierFile(buffer, "test-ramedicas-v2.xlsx", supplierId);
    expect(analysis.alreadyImported).toBeNull(); // contenido distinto -> hash distinto

    const mapping: ColumnMapping = {};
    for (const col of analysis.columns) if (col.proposedTarget) mapping[col.proposedTarget] = col.index;

    const report = await confirmSupplierImport({
      fileToken: analysis.fileToken,
      supplierId,
      sheetName: analysis.selectedSheet,
      headerRowIndex: analysis.headerRowIndex,
      mapping,
      priceFormat: { thousands: ".", decimal: "," },
    });

    expect(report.updatedOffers).toBeGreaterThan(0);

    const offer = await prisma.supplierOffer.findFirst({
      where: { supplierId, product: { normalizedName: { contains: "ibuprofeno" } } },
    });
    expect(Number(offer!.price)).toBe(9000);

    const history = await prisma.priceHistory.findMany({ where: { supplierOfferId: offer!.id } });
    expect(history.length).toBe(2); // precio inicial (8500) + el nuevo (9000)
  });
});
