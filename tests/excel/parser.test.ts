import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseWorkbook } from "@/lib/excel/parser";

function buildXlsBuffer(rows: (string | number)[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Hoja1");
  const arrayBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xls" });
  return Buffer.from(arrayBuffer);
}

describe("parseWorkbook (.xls, formato Excel 97-2003)", () => {
  it("lee filas y hojas de un archivo .xls real", async () => {
    const buffer = buildXlsBuffer([
      ["Producto", "Cantidad"],
      ["ACETAMINOFEN TAB 500MG X100", 50],
      ["IBUPROFENO TAB 400MG X30", 0],
    ]);

    const workbook = await parseWorkbook(buffer, "inventario.xls");
    expect(workbook.sheets.map((s) => s.name)).toEqual(["Hoja1"]);

    const rows = workbook.getRows("Hoja1");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ 0: "Producto", 1: "Cantidad" });
    expect(rows[1]).toEqual({ 0: "ACETAMINOFEN TAB 500MG X100", 1: 50 });
    // Una cantidad en 0 debe seguir presente en la fila, no tratarse como celda vacía.
    expect(rows[2]).toEqual({ 0: "IBUPROFENO TAB 400MG X30", 1: 0 });
  });

  it("rechaza formatos no soportados con un mensaje claro", async () => {
    await expect(parseWorkbook(Buffer.from(""), "archivo.pdf")).rejects.toThrow(/Formato de archivo no soportado/);
  });
});
