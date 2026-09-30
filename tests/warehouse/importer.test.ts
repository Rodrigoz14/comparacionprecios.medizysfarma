import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { importWarehouseStock } from "@/lib/warehouse/importer";
import { buildGenericKey, normalizeText } from "@/lib/matching/normalize";
import { extractProductAttributes } from "@/lib/matching/extract-attributes";

async function buildXlsxBuffer(rows: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Bodega");
  for (const row of rows) sheet.addRow(row);
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe("importWarehouseStock (integracion contra base de datos real)", () => {
  afterEach(async () => {
    await prisma.warehouseStock.deleteMany({});
  });

  it("suma cantidades de filas distintas que describen el mismo generico, y guarda las que no reconoce igual (nunca las descarta)", async () => {
    // Confirmado con el cliente (2026-09-30): bodega NO depende de que el
    // producto exista en el catálogo de Proveedores -- eso solo importa al
    // calcular una Solicitud. Aquí solo se interpreta el propio texto.
    const genericKey = buildGenericKey(extractProductAttributes("BODEGAIMPORT TAB 250MG X20")!.attributes);

    const buffer = await buildXlsxBuffer([
      ["Producto", "Cantidad"],
      ["BODEGAIMPORT TAB 250MG X20", 15],
      ["BODEGAIMPORT TAB 250MG X50", 25], // mismo genérico, otra presentación -> suma igual
      ["INSUMO SIN PRINCIPIO ACTIVO RECONOCIBLE", 5], // no describe ningún medicamento
    ]);

    const report = await importWarehouseStock(buffer, "bodega-test.xlsx");

    expect(report.totalRows).toBe(3);
    expect(report.distinctProducts).toBe(2); // el genérico reconocido + el que no, ninguno se descarta

    const stock = await prisma.warehouseStock.findUnique({ where: { genericKey } });
    expect(stock?.quantity).toBe(40); // 15 + 25

    const unrecognized = await prisma.warehouseStock.findUnique({
      where: { genericKey: normalizeText("INSUMO SIN PRINCIPIO ACTIVO RECONOCIBLE") },
    });
    expect(unrecognized?.quantity).toBe(5);
    expect(unrecognized?.rawProductName).toBe("INSUMO SIN PRINCIPIO ACTIVO RECONOCIBLE");
  });

  it("una nueva importacion reemplaza el inventario anterior por completo", async () => {
    const bufferInicial = await buildXlsxBuffer([
      ["Producto", "Cantidad"],
      ["BODEGAIMPORT TAB 250MG X20", 15],
    ]);
    await importWarehouseStock(bufferInicial, "bodega-test-1.xlsx");

    const bufferNuevo = await buildXlsxBuffer([
      ["Producto", "Cantidad"],
      ["BODEGAIMPORT TAB 250MG X20", 5],
    ]);
    await importWarehouseStock(bufferNuevo, "bodega-test-2.xlsx");

    const genericKey = buildGenericKey(extractProductAttributes("BODEGAIMPORT TAB 250MG X20")!.attributes);
    const stock = await prisma.warehouseStock.findUnique({ where: { genericKey } });
    expect(stock?.quantity).toBe(5); // no 20 -- se reemplazo, no se sumo sobre la importacion anterior

    const allStock = await prisma.warehouseStock.findMany();
    expect(allStock.length).toBe(1); // el inventario global quedo reemplazado, no acumulado
  });

  // Bug real: un Kardex de bodega trae un título y una fecha antes del
  // encabezado real -- el detector solo miraba la fila 0 y nunca encontraba
  // el encabezado, así que el título y la fecha se importaban como si fueran
  // filas de producto.
  it("ignora filas de titulo/fecha antes del encabezado real", async () => {
    const buffer = await buildXlsxBuffer([
      ["Rotación Kardex"],
      ["Fecha I", "1/01/2026"],
      ["Código", "Nombre Articulo", "Saldo Fin"],
      ["ME0001", "BODEGAIMPORT TAB 250MG X20", 12],
      ["ME0002", "INSUMO SIN PRINCIPIO ACTIVO RECONOCIBLE", 5],
    ]);

    const report = await importWarehouseStock(buffer, "kardex-test.xlsx");

    expect(report.totalRows).toBe(2); // no cuenta el título ni la fecha como filas

    const genericKey = buildGenericKey(extractProductAttributes("BODEGAIMPORT TAB 250MG X20")!.attributes);
    const stock = await prisma.warehouseStock.findUnique({ where: { genericKey } });
    expect(stock?.quantity).toBe(12);
  });

  it("una fila en existencia 0 no queda guardada en bodega", async () => {
    const buffer = await buildXlsxBuffer([
      ["Producto", "Cantidad"],
      ["BODEGAIMPORT TAB 250MG X20", 0],
    ]);

    const report = await importWarehouseStock(buffer, "bodega-cero.xlsx");

    expect(report.totalRows).toBe(1);
    expect(report.distinctProducts).toBe(0); // no se guarda en 0, para no confundir

    const genericKey = buildGenericKey(extractProductAttributes("BODEGAIMPORT TAB 250MG X20")!.attributes);
    const stock = await prisma.warehouseStock.findUnique({ where: { genericKey } });
    expect(stock).toBeNull();
  });
});
