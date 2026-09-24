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

  it("dos filas con el mismo nombre pero distinto código se guardan como ofertas separadas, no se descartan como duplicadas", async () => {
    // Confirmado con el cliente (2026-09-23): el nombre puede repetirse por
    // una variación real (código distinto) que el texto no refleja -- ambas
    // filas deben importarse, no solo la última.
    const rows = [
      HEADER,
      ["V001", "VARITEST TAB 250MG X30", "MK", "4.000", "20"],
      ["V002", "VARITEST TAB 250MG X30", "MK", "4.500", "15"],
    ];
    const buffer = await buildXlsxBuffer(rows);
    const analysis = await analyzeSupplierFile(buffer, "variacion-codigo.xlsx", supplierId);
    const mapping: ColumnMapping = {};
    for (const col of analysis.columns) if (col.proposedTarget) mapping[col.proposedTarget] = col.index;

    const report = await confirmSupplierImport({
      buffer,
      originalName: "variacion-codigo.xlsx",
      storagePath: null,
      supplierId,
      sheetName: analysis.selectedSheet,
      headerRowIndex: analysis.headerRowIndex,
      mapping,
      priceFormat: { thousands: ".", decimal: "," },
    });

    expect(report.importedRows).toBe(2);
    expect(report.newProducts).toBe(2);

    const offers = await prisma.supplierOffer.findMany({
      where: { supplierId, product: { normalizedName: { contains: "varitest" } } },
      orderBy: { supplierProductCode: "asc" },
    });
    expect(offers).toHaveLength(2);
    expect(offers[0].supplierProductCode).toBe("V001");
    expect(Number(offers[0].price)).toBe(4000);
    expect(offers[1].supplierProductCode).toBe("V002");
    expect(Number(offers[1].price)).toBe(4500);

    // Reimportar con el MISMO código actualiza esa oferta puntual, sin crear una tercera.
    const updatedBuffer = await buildXlsxBuffer([
      HEADER,
      ["V001", "VARITEST TAB 250MG X30", "MK", "4.100", "20"],
      ["V002", "VARITEST TAB 250MG X30", "MK", "4.500", "15"],
    ]);
    await confirmSupplierImport({
      buffer: updatedBuffer,
      originalName: "variacion-codigo-v2.xlsx",
      storagePath: null,
      supplierId,
      sheetName: analysis.selectedSheet,
      headerRowIndex: analysis.headerRowIndex,
      mapping,
      priceFormat: { thousands: ".", decimal: "," },
    });

    const offersAfter = await prisma.supplierOffer.findMany({
      where: { supplierId, product: { normalizedName: { contains: "varitest" } } },
    });
    expect(offersAfter).toHaveLength(2);
    expect(offersAfter.find((o) => o.supplierProductCode === "V001") && Number(offersAfter.find((o) => o.supplierProductCode === "V001")!.price)).toBe(4100);
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

  it("Disfarma: ubica las columnas por su nombre exacto, multiplica el precio por unidad por las unidades del empaque, y guarda el precio unitario y la categoría de vencimiento tal como vinieron", async () => {
    await withSupplier("Disfarma", async (supplierId) => {
      const rows = [
        ["CODIGO", "DESCRIPCION", "Ger_EPS_UND", "FORMA_FARMACEUTICA", "PRESENTACION", "LABORATORIO", "FEC_VENC"],
        // FEC_VENC no es una fecha -- es una categoría de texto que ya trae
        // el proveedor ("SUPERIOR A 12 MESES", "FECHA CORTA <mes>").
        ["D100", "AMOXICILINA 500MG", 100, "TABLETA", "X20", "MK", "SUPERIOR A 12 MESES"],
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
      expect(amoxicilina!.expirationLabel).toBe("SUPERIOR A 12 MESES");

      const acetaminofen = await prisma.supplierOffer.findFirst({
        where: { supplierId, product: { normalizedName: { contains: "acetaminofen" } } },
      });
      expect(Number(acetaminofen!.price)).toBe(500); // inyectable: sin multiplicar
      expect(Number(acetaminofen!.unitPriceAsImported)).toBe(500);
      expect(acetaminofen!.expirationLabel).toBeNull();
    });
  });

  it("Disfarma: dos filas con el mismo código pero distinta vigencia son LOTES distintos, se guardan las dos", async () => {
    // Caso real reportado por el cliente (2026-09-23): mismo código
    // (133336), mismo nombre, mismo precio -- solo cambia FEC_VENC entre
    // "FECHA CORTA MARZO" y "SUPERIOR A 12 MESES". Son dos lotes reales
    // distintos, no una fila duplicada a descartar.
    await withSupplier("Disfarma", async (supplierId) => {
      const rows = [
        ["CODIGO", "DESCRIPCION", "Ger_EPS_UND", "FORMA_FARMACEUTICA", "PRESENTACION", "LABORATORIO", "FEC_VENC"],
        ["133336", "EPS-ABACAVIR+DOLUTEGRAVIR+LAMIVUDINA 600MG+50MG+300MG TAB FCOX30", 13100, "TABLETA", "X30", "GLAXOSMITHKLINE", "FECHA CORTA MARZO"],
        ["133336", "EPS-ABACAVIR+DOLUTEGRAVIR+LAMIVUDINA 600MG+50MG+300MG TAB FCOX30", 13100, "TABLETA", "X30", "GLAXOSMITHKLINE", "SUPERIOR A 12 MESES"],
      ];
      const buffer = await buildXlsxBuffer(rows);
      const analysis = await analyzeSupplierFile(buffer, "disfarma-lotes.xlsx", supplierId);
      const mapping: ColumnMapping = {};
      for (const col of analysis.columns) if (col.proposedTarget) mapping[col.proposedTarget] = col.index;

      const report = await confirmSupplierImport({
        buffer,
        originalName: "disfarma-lotes.xlsx",
        storagePath: null,
        supplierId,
        sheetName: analysis.selectedSheet,
        headerRowIndex: analysis.headerRowIndex,
        mapping,
        priceFormat: { thousands: ".", decimal: "," },
      });

      expect(report.importedRows).toBe(2);
      expect(report.warnings.some((w) => w.message.includes("duplicado"))).toBe(false);

      const offers = await prisma.supplierOffer.findMany({
        where: { supplierId, product: { normalizedName: { contains: "abacavir" } } },
      });
      expect(offers).toHaveLength(2);
      expect(offers.map((o) => o.expirationLabel).sort()).toEqual(["FECHA CORTA MARZO", "SUPERIOR A 12 MESES"]);
    });
  });

  it("Disfarma: sin ningún conteo de empaque (ni en el nombre ni en PRESENTACION), no se rechaza la fila -- el precio de empaque queda igual al precio unidad", async () => {
    // Confirmado con el cliente (2026-09-24): antes estas filas se
    // descartaban del todo por no poder determinar la presentación; ahora
    // se importan asumiendo 1 unidad, así que precio de empaque = precio
    // unidad (sin multiplicar).
    await withSupplier("Disfarma", async (supplierId) => {
      const rows = [
        ["CODIGO", "DESCRIPCION", "Ger_EPS_UND", "FORMA_FARMACEUTICA", "PRESENTACION", "LABORATORIO", "FEC_VENC"],
        ["D300", "AMOXICILINA 500MG CAPSULA", 1500, "CAPSULA", "", "MK", ""],
      ];
      const buffer = await buildXlsxBuffer(rows);
      const analysis = await analyzeSupplierFile(buffer, "disfarma-sin-conteo.xlsx", supplierId);
      const mapping: ColumnMapping = {};
      for (const col of analysis.columns) if (col.proposedTarget) mapping[col.proposedTarget] = col.index;

      const report = await confirmSupplierImport({
        buffer,
        originalName: "disfarma-sin-conteo.xlsx",
        storagePath: null,
        supplierId,
        sheetName: analysis.selectedSheet,
        headerRowIndex: analysis.headerRowIndex,
        mapping,
        priceFormat: { thousands: ".", decimal: "," },
      });
      expect(report.errorRows).toBe(0);
      expect(report.importedRows).toBe(1);

      const offer = await prisma.supplierOffer.findFirst({
        where: { supplierId, product: { normalizedName: { contains: "amoxicilina" } } },
      });
      expect(Number(offer!.price)).toBe(1500); // sin conteo -> precio de empaque = precio unidad
      expect(Number(offer!.unitPriceAsImported)).toBe(1500);
    });
  });

  it("Disfarma: presentación medida en ml (jarabe) sin unidades nombradas -- no se multiplica el precio unitario por el volumen", async () => {
    // Confirmado con el cliente (2026-09-24): "240ML" es el volumen del
    // único frasco, no una cantidad de envases a multiplicar -- el precio
    // reportado ya es el del frasco completo.
    await withSupplier("Disfarma", async (supplierId) => {
      const rows = [
        ["CODIGO", "DESCRIPCION", "Ger_EPS_UND", "FORMA_FARMACEUTICA", "PRESENTACION", "LABORATORIO", "FEC_VENC"],
        ["D400", "ACETAMINOFEN 150MG/5ML JARABE", 5000, "JARABE", "FCO X 240ML", "MK", ""],
      ];
      const buffer = await buildXlsxBuffer(rows);
      const analysis = await analyzeSupplierFile(buffer, "disfarma-jarabe.xlsx", supplierId);
      const mapping: ColumnMapping = {};
      for (const col of analysis.columns) if (col.proposedTarget) mapping[col.proposedTarget] = col.index;

      const report = await confirmSupplierImport({
        buffer,
        originalName: "disfarma-jarabe.xlsx",
        storagePath: null,
        supplierId,
        sheetName: analysis.selectedSheet,
        headerRowIndex: analysis.headerRowIndex,
        mapping,
        priceFormat: { thousands: ".", decimal: "," },
      });
      expect(report.errorRows).toBe(0);
      expect(report.importedRows).toBe(1);

      const offer = await prisma.supplierOffer.findFirst({
        where: { supplierId, product: { normalizedName: { contains: "acetaminofen" } } },
        include: { product: true },
      });
      expect(offer!.product.presentationUnit).toBe("ml");
      expect(Number(offer!.price)).toBe(5000); // sin multiplicar por los 240ml
      expect(Number(offer!.unitPriceAsImported)).toBe(5000);
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

  it("Ramédicas: dos filas con el mismo nombre pero distinto CODIGO INTERNO MEDICAMENTO también se guardan las dos", async () => {
    // Misma lógica compartida (lib/excel/importer.ts) que Disfarma y
    // Offimédicas -- no es algo especial de un solo proveedor.
    await withSupplier("Ramedicas", async (supplierId) => {
      const rows = [
        ["CODIGO INTERNO MEDICAMENTO", "DESCRIPCION COMPLETA DE PRODUCTO", "PRESENTACION", "PRECIO X UD", "LABORATORIO", "STOCK ACTUAL"],
        ["R010", "VARITEST3 400MG X20", "X20 TAB", 50, "MK", 20],
        ["R020", "VARITEST3 400MG X20", "X20 TAB", 55, "MK", 10],
      ];
      const buffer = await buildXlsxBuffer(rows);
      const analysis = await analyzeSupplierFile(buffer, "ramedicas-variacion.xlsx", supplierId);
      const mapping: ColumnMapping = {};
      for (const col of analysis.columns) if (col.proposedTarget) mapping[col.proposedTarget] = col.index;

      const report = await confirmSupplierImport({
        buffer,
        originalName: "ramedicas-variacion.xlsx",
        storagePath: null,
        supplierId,
        sheetName: analysis.selectedSheet,
        headerRowIndex: analysis.headerRowIndex,
        mapping,
        priceFormat: { thousands: ".", decimal: "," },
      });

      expect(report.importedRows).toBe(2);
      const offers = await prisma.supplierOffer.findMany({
        where: { supplierId, product: { normalizedName: { contains: "varitest3" } } },
      });
      expect(offers).toHaveLength(2);
      expect(offers.map((o) => o.supplierProductCode).sort()).toEqual(["R010", "R020"]);
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

  it("Offimédicas: dos filas con el mismo nombre pero distinto ID_PRODUCTO también se guardan las dos", async () => {
    // La preservación de "duplicados" con código distinto no es exclusiva
    // de Disfarma -- es la misma lógica compartida (lib/excel/importer.ts)
    // para cualquier proveedor con columna de código, incluido Offimédicas.
    await withSupplier("Offimedicas", async (supplierId) => {
      const rows = [
        ["ID_PRODUCTO", "PRODUCTO", "LABORATORIO", "CANTIDAD", "PRECIO UND"],
        ["O010", "VARITEST2 500MG X20", "MK", 10, 50],
        ["O020", "VARITEST2 500MG X20", "MK", 5, 55],
      ];
      const buffer = await buildXlsxBuffer(rows);
      const analysis = await analyzeSupplierFile(buffer, "offimedicas-variacion.xlsx", supplierId);
      const mapping: ColumnMapping = {};
      for (const col of analysis.columns) if (col.proposedTarget) mapping[col.proposedTarget] = col.index;

      const report = await confirmSupplierImport({
        buffer,
        originalName: "offimedicas-variacion.xlsx",
        storagePath: null,
        supplierId,
        sheetName: analysis.selectedSheet,
        headerRowIndex: analysis.headerRowIndex,
        mapping,
        priceFormat: { thousands: ".", decimal: "," },
      });

      expect(report.importedRows).toBe(2);
      const offers = await prisma.supplierOffer.findMany({
        where: { supplierId, product: { normalizedName: { contains: "varitest2" } } },
      });
      expect(offers).toHaveLength(2);
      expect(offers.map((o) => o.supplierProductCode).sort()).toEqual(["O010", "O020"]);
    });
  });

  it("una fila con precio calculado absurdo se rechaza como error, sin tumbar el resto del archivo", async () => {
    // Bug real (2026-09-23): una fila de Offimédicas con la cantidad del
    // empaque mal extraída producía un precio que no cabía en la base de
    // datos ("numeric field overflow"), y como varias filas se procesan
    // dentro de la MISMA transacción por lote, esa sola fila tumbaba la
    // importación completa de miles de filas válidas.
    await withSupplier("Offimedicas", async (supplierId) => {
      const rows = [
        ["ID_PRODUCTO", "PRODUCTO", "LABORATORIO", "CANTIDAD", "PRECIO UND"],
        ["O001", "METFORMINA 850MG X30", "MK", 15, 40],
        // Cantidad del empaque absurdamente grande -> precio calculado
        // (100 x 99.999.999) muy por encima de lo real.
        ["O003", "OVERFLOWTEST 100MG TAB X 99999999", "MK", 10, 100],
      ];
      const buffer = await buildXlsxBuffer(rows);
      const analysis = await analyzeSupplierFile(buffer, "offimedicas-overflow.xlsx", supplierId);
      const mapping: ColumnMapping = {};
      for (const col of analysis.columns) if (col.proposedTarget) mapping[col.proposedTarget] = col.index;

      const report = await confirmSupplierImport({
        buffer,
        originalName: "offimedicas-overflow.xlsx",
        storagePath: null,
        supplierId,
        sheetName: analysis.selectedSheet,
        headerRowIndex: analysis.headerRowIndex,
        mapping,
        priceFormat: { thousands: ".", decimal: "," },
      });

      expect(report.errorRows).toBe(1);
      expect(report.errors[0]?.message).toContain("absurdamente alto");
      // La otra fila válida del mismo archivo/lote SÍ debe importarse.
      expect(report.importedRows).toBe(1);
      const metformina = await prisma.supplierOffer.findFirst({
        where: { supplierId, product: { normalizedName: { contains: "metformina" } } },
      });
      expect(metformina).not.toBeNull();
    });
  });

  it("un archivo con mas de un lote (BATCH_SIZE=100) importa y reimporta todas las filas correctamente, incluidas dos que comparten producto dentro del mismo lote", async () => {
    // 117 filas x 2 importaciones completas son mas trabajo que el timeout
    // por defecto de vitest (5s), aunque cada fila individual sea rapida.
    // Bug real (2026-09-24): buscar el producto y la oferta existentes fila
    // por fila (en vez de precargarlos por lote) hacía que archivos reales de
    // miles de filas (p. ej. Ramédicas, ~7.700) superaran el límite de tiempo
    // de la función serverless y quedaran a medio importar. Este archivo
    // sintético de 117 filas cruza la frontera de un lote (100) para probar
    // que ninguna fila se pierde ni se procesa dos veces en el lote/consulta
    // equivocados.
    await withSupplier("Ofimedicas", async (supplierId) => {
      const rows: (string | number)[][] = [["ID_PRODUCTO", "PRODUCTO", "LABORATORIO", "CANTIDAD", "PRECIO UND"]];
      for (let i = 1; i <= 115; i++) {
        rows.push([`LOTE${i}`, `PRODUCTOLOTE${i} 100MG TAB X10`, "MK", 10, 50]);
      }
      // Dos filas que comparten el MISMO producto (mismo nombre -> mismo
      // normalizedName) pero código distinto, colocadas juntas dentro del
      // primer lote (filas 30-31 de 117): la segunda debe encontrar el
      // producto que la primera acaba de crear en ESE MISMO lote, no crearlo
      // de nuevo (violaría la unicidad de normalizedName).
      rows.splice(30, 0, ["COMPARTIDO-A", "PRODUCTOCOMPARTIDO 100MG TAB X10", "MK", 10, 60]);
      rows.splice(31, 0, ["COMPARTIDO-B", "PRODUCTOCOMPARTIDO 100MG TAB X10", "MK", 5, 65]);

      const buffer = await buildXlsxBuffer(rows);
      const analysis = await analyzeSupplierFile(buffer, "ofimedicas-multilote.xlsx", supplierId);
      const mapping: ColumnMapping = {};
      for (const col of analysis.columns) if (col.proposedTarget) mapping[col.proposedTarget] = col.index;

      const report = await confirmSupplierImport({
        buffer,
        originalName: "ofimedicas-multilote.xlsx",
        storagePath: null,
        supplierId,
        sheetName: analysis.selectedSheet,
        headerRowIndex: analysis.headerRowIndex,
        mapping,
        priceFormat: { thousands: ".", decimal: "," },
      });

      expect(report.errorRows).toBe(0);
      expect(report.importedRows).toBe(117); // 115 individuales + 2 del producto compartido
      expect(report.newProducts).toBe(117); // 117 ofertas nuevas

      const compartido = await prisma.supplierOffer.findMany({
        where: { supplierId, product: { normalizedName: { contains: "productocompartido" } } },
      });
      expect(compartido).toHaveLength(2); // mismo producto, 2 ofertas (códigos distintos)
      expect(compartido.every((o) => o.productId === compartido[0]!.productId)).toBe(true);

      // Filas a ambos lados de la frontera del lote (99, 100, 101 del array
      // "unique" -- con las 2 filas insertadas de más, corresponden a
      // LOTE97/98/99 aprox.) deben haberse guardado igual que las demás.
      const primero = await prisma.supplierOffer.findFirst({
        where: { supplierId, product: { normalizedName: { contains: "productolote1 " } } },
      });
      const ultimo = await prisma.supplierOffer.findFirst({
        where: { supplierId, product: { normalizedName: { contains: "productolote115" } } },
      });
      expect(primero).not.toBeNull();
      expect(ultimo).not.toBeNull();

      // Reimportar el mismo archivo con precios distintos debe ACTUALIZAR
      // las 117 ofertas (no crear duplicadas), también cruzando la frontera
      // del lote.
      const updatedRows = rows.map((r, i) => (i === 0 ? r : [r[0], r[1], r[2], r[3], Number(r[4]) + 1]));
      const updatedBuffer = await buildXlsxBuffer(updatedRows);
      const reimportReport = await confirmSupplierImport({
        buffer: updatedBuffer,
        originalName: "ofimedicas-multilote.xlsx",
        storagePath: null,
        supplierId,
        sheetName: analysis.selectedSheet,
        headerRowIndex: analysis.headerRowIndex,
        mapping,
        priceFormat: { thousands: ".", decimal: "," },
        force: true,
      });
      expect(reimportReport.importedRows).toBe(117);
      expect(reimportReport.newProducts).toBe(0);
      expect(reimportReport.updatedOffers).toBe(117);

      const totalOfertas = await prisma.supplierOffer.count({ where: { supplierId } });
      expect(totalOfertas).toBe(117); // no se duplicaron ofertas al reimportar

      const primeroActualizado = await prisma.supplierOffer.findFirst({
        where: { supplierId, product: { normalizedName: { contains: "productolote1 " } } },
      });
      expect(Number(primeroActualizado!.price)).toBe(510); // 51 x 10 unidades
    });
  }, 30000);
});
