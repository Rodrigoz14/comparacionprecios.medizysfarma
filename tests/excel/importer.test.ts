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
      buffer: baseBuffer,
      originalName: "test-ramedicas.xlsx",
      storagePath: null,
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
        buffer: baseBuffer,
        originalName: "test-ramedicas.xlsx",
        storagePath: null,
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
      buffer,
      originalName: "test-ramedicas-v2.xlsx",
      storagePath: null,
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

  it("no propone como precio una columna mayormente en cero, aunque su nombre coincida por texto", async () => {
    // Caso real de un archivo de Disfarma: "VLR_TOPE_REG" (techo regulatorio,
    // casi siempre 0) se proponía como precio por contener "vlr", en vez de
    // "Ger_EPS" (el precio real, sin ningún alias reconocible en su nombre) —
    // miles de filas se rechazaban por precio 0, o se importaban con el precio
    // equivocado. Si la muestra es mayormente cero, no se propone ninguna
    // columna: mejor obligar a elegir a mano que corromper el catálogo.
    const rows = [
      ["CODIGO", "DESCRIPCION", "GER_EPS", "VLR_TOPE_REG"],
      ["D001", "AMOXICILINA TAB 500MG X30", 12000, 0],
      ["D002", "DICLOFENACO TAB 50MG X20", 3200, 0],
      ["D003", "LORATADINA TAB 10MG X10", 2800, 45000],
      ["D004", "METFORMINA TAB 850MG X30", 5100, 0],
    ];
    const buffer = await buildXlsxBuffer(rows);
    const result = await analyzeSupplierFile(buffer, "disfarma-vlr-tope.xlsx", supplierId);

    const priceColumn = result.columns.find((c) => c.header === "VLR_TOPE_REG");
    expect(priceColumn?.proposedTarget).toBeNull();
    expect(result.columns.some((c) => c.proposedTarget === "price")).toBe(false);
  });
});

describe("perfiles fijos de proveedor conocido (integracion contra base de datos real)", () => {
  async function withSupplier(namePrefix: string, run: (supplierId: string) => Promise<void>) {
    const supplier = await prisma.supplier.create({ data: { name: `${namePrefix} ${Date.now()}` } });
    try {
      await run(supplier.id);
    } finally {
      const offers = await prisma.supplierOffer.findMany({
        where: { supplierId: supplier.id },
        select: { id: true, productId: true },
      });
      const offerIds = offers.map((o) => o.id);
      const productIds = offers.map((o) => o.productId);
      await prisma.priceHistory.deleteMany({ where: { supplierOfferId: { in: offerIds } } });
      await prisma.supplierOffer.deleteMany({ where: { supplierId: supplier.id } });
      await prisma.supplierFile.deleteMany({ where: { supplierId: supplier.id } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
      await prisma.supplier.delete({ where: { id: supplier.id } });
    }
  }

  it("Disfarma: ubica las columnas por su nombre exacto, multiplica el precio por unidad por las unidades del empaque, y guarda el precio unitario y la fecha de vencimiento tal como vinieron", async () => {
    await withSupplier("Disfarma", async (supplierId) => {
      const rows = [
        ["CODIGO", "DESCRIPCION", "Ger_EPS_UND", "FORMA_FARMACEUTICA", "PRESENTACION", "LABORATORIO", "FEC_VENC"],
        ["D100", "AMOXICILINA 500MG", 100, "TABLETA", "X20", "MK", "15/05/2027"],
        // Inyectable: el precio por "unidad" NO se multiplica por el volumen del vial
        // (siempre se compra como 1 vial sellado, sin importar cuántos ml traiga).
        ["D200", "ACETAMINOFEN 500MG INYECTABLE", 500, "INYECTABLE", "X100ML", "MK", ""],
      ];
      const buffer = await buildXlsxBuffer(rows);

      const analysis = await analyzeSupplierFile(buffer, "disfarma.xlsx", supplierId);
      expect(analysis.fixedProfile?.key).toBe("disfarma");
      const byTarget = Object.fromEntries(analysis.columns.map((c) => [c.proposedTarget, c.index]));
      expect(byTarget.supplierProductCode).toBe(0);
      expect(byTarget.productName).toBe(1);
      expect(byTarget.price).toBe(2);
      expect(byTarget.dosageForm).toBe(3);
      expect(byTarget.presentation).toBe(4);
      expect(byTarget.laboratory).toBe(5);
      expect(byTarget.expirationDate).toBe(6);

      const mapping: ColumnMapping = {};
      for (const col of analysis.columns) if (col.proposedTarget) mapping[col.proposedTarget] = col.index;

      const report = await confirmSupplierImport({
        buffer,
        originalName: "disfarma.xlsx",
        storagePath: null,
        supplierId,
        sheetName: analysis.selectedSheet,
        headerRowIndex: analysis.headerRowIndex,
        mapping,
        priceFormat: { thousands: ".", decimal: "," },
      });
      expect(report.errorRows).toBe(0);
      expect(report.importedRows).toBe(2);

      const amoxicilina = await prisma.supplierOffer.findFirst({
        where: { supplierId, product: { normalizedName: { contains: "amoxicilina" } } },
      });
      expect(Number(amoxicilina!.price)).toBe(2000); // 100 x 20 tabletas
      expect(Number(amoxicilina!.unitPriceAsImported)).toBe(100); // tal como vino, sin calcular
      expect(amoxicilina!.expirationDate?.toISOString().slice(0, 10)).toBe("2027-05-15");

      const acetaminofen = await prisma.supplierOffer.findFirst({
        where: { supplierId, product: { normalizedName: { contains: "acetaminofen" } } },
      });
      expect(Number(acetaminofen!.price)).toBe(500); // inyectable: sin multiplicar
      expect(Number(acetaminofen!.unitPriceAsImported)).toBe(500);
      expect(acetaminofen!.expirationDate).toBeNull();
    });
  });

  it("Ramédicas: excluye del todo las filas con STOCK ACTUAL = 0 (no se importan, no cuentan como error)", async () => {
    await withSupplier("Ramedicas", async (supplierId) => {
      const rows = [
        ["CODIGO INTERNO MEDICAMENTO", "DESCRIPCION COMPLETA DE PRODUCTO", "PRESENTACION", "PRECIO X UD", "LABORATORIO", "STOCK ACTUAL"],
        ["R001", "IBUPROFENO 400MG", "X30 TAB", 50, "MK", 20],
        ["R002", "LORATADINA 10MG", "X10 TAB", 30, "MK", 0],
      ];
      const buffer = await buildXlsxBuffer(rows);

      const analysis = await analyzeSupplierFile(buffer, "ramedicas.xlsx", supplierId);
      expect(analysis.fixedProfile?.key).toBe("ramedicas");
      // La fila sin existencia no debe aparecer ni en la previsualización.
      expect(analysis.previewRows.some((r) => String(r[0]) === "R002")).toBe(false);

      const mapping: ColumnMapping = {};
      for (const col of analysis.columns) if (col.proposedTarget) mapping[col.proposedTarget] = col.index;

      const report = await confirmSupplierImport({
        buffer,
        originalName: "ramedicas.xlsx",
        storagePath: null,
        supplierId,
        sheetName: analysis.selectedSheet,
        headerRowIndex: analysis.headerRowIndex,
        mapping,
        priceFormat: { thousands: ".", decimal: "," },
      });

      expect(report.excludedRows).toBe(1);
      expect(report.importedRows).toBe(1);

      const loratadina = await prisma.supplierOffer.findFirst({
        where: { supplierId, product: { normalizedName: { contains: "loratadina" } } },
      });
      expect(loratadina).toBeNull();

      const ibuprofeno = await prisma.supplierOffer.findFirst({
        where: { supplierId, product: { normalizedName: { contains: "ibuprofeno" } } },
      });
      expect(Number(ibuprofeno!.price)).toBe(1500); // 50 x 30 tabletas
    });
  });

  it("Offimédicas: excluye filas con CANTIDAD = 0, usando ID_PRODUCTO/PRODUCTO/PRECIO UND", async () => {
    await withSupplier("Offimedicas", async (supplierId) => {
      const rows = [
        ["ID_PRODUCTO", "PRODUCTO", "LABORATORIO", "CANTIDAD", "PRECIO UND"],
        ["O001", "METFORMINA 850MG X30", "MK", 15, 40],
        ["O002", "OMEPRAZOL 20MG X30", "MK", 0, 60],
      ];
      const buffer = await buildXlsxBuffer(rows);

      const analysis = await analyzeSupplierFile(buffer, "offimedicas.xlsx", supplierId);
      expect(analysis.fixedProfile?.key).toBe("offimedicas");

      const mapping: ColumnMapping = {};
      for (const col of analysis.columns) if (col.proposedTarget) mapping[col.proposedTarget] = col.index;

      const report = await confirmSupplierImport({
        buffer,
        originalName: "offimedicas.xlsx",
        storagePath: null,
        supplierId,
        sheetName: analysis.selectedSheet,
        headerRowIndex: analysis.headerRowIndex,
        mapping,
        priceFormat: { thousands: ".", decimal: "," },
      });

      expect(report.excludedRows).toBe(1);
      expect(report.importedRows).toBe(1);

      const metformina = await prisma.supplierOffer.findFirst({
        where: { supplierId, product: { normalizedName: { contains: "metformina" } } },
      });
      expect(Number(metformina!.price)).toBe(1200); // 40 x 30 tabletas
    });
  });
});
