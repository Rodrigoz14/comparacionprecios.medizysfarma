import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import type { RawRow, SheetInfo } from "@/lib/excel/types";

export interface ParsedWorkbook {
  sheets: SheetInfo[];
  getRows(sheetName: string): RawRow[];
}

function cellToValue(value: ExcelJS.CellValue): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "text" in value) {
    return String((value as { text: unknown }).text);
  }
  if (typeof value === "object" && "result" in value) {
    return cellToValue((value as { result: ExcelJS.CellValue }).result);
  }
  return String(value);
}

export async function parseWorkbook(buffer: Buffer, originalName: string): Promise<ParsedWorkbook> {
  const workbook = new ExcelJS.Workbook();
  const lowerName = originalName.toLowerCase();

  if (lowerName.endsWith(".csv")) {
    await workbook.csv.read(Readable.from(buffer));
  } else if (lowerName.endsWith(".xlsx")) {
    // exceljs's bundled type for `Buffer` resolves against a different nested
    // @types/node (via @fast-csv) than this project's, so the two Buffer
    // generics don't structurally match even though they're identical at runtime.
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } else {
    throw new Error(
      "Formato de archivo no soportado. Usa .xlsx o .csv (el formato .xls antiguo no está soportado; expórtalo como .xlsx).",
    );
  }

  const sheets: SheetInfo[] = workbook.worksheets.map((sheet) => ({
    name: sheet.name,
    rowCount: sheet.rowCount,
  }));

  return {
    sheets,
    getRows(sheetName: string): RawRow[] {
      const sheet = workbook.getWorksheet(sheetName);
      if (!sheet) throw new Error(`La hoja "${sheetName}" no existe en el archivo.`);

      const rows: RawRow[] = [];
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const raw: RawRow = {};
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
          raw[colNumber - 1] = cellToValue(cell.value);
        });
        rows.push(raw);
      });
      return rows;
    },
  };
}
