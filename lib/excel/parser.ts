import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import * as XLS from "xlsx";
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

async function parseWithExcelJS(buffer: Buffer, isCsv: boolean): Promise<ParsedWorkbook> {
  const workbook = new ExcelJS.Workbook();
  if (isCsv) {
    await workbook.csv.read(Readable.from(buffer));
  } else {
    // exceljs's bundled type for `Buffer` resolves against a different nested
    // @types/node (via @fast-csv) than this project's, so the two Buffer
    // generics don't structurally match even though they're identical at runtime.
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
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

function xlsCellToValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * El formato binario .xls (Excel 97-2003) no lo lee exceljs (solo entiende
 * el formato OOXML de .xlsx/.xlsm) -- se usa la librería `xlsx` (SheetJS)
 * solo para este caso. Instalada desde el paquete oficial de SheetJS
 * (cdn.sheetjs.com), no desde el registro de npm: la versión publicada ahí
 * (0.18.5) tiene vulnerabilidades conocidas (prototype pollution y ReDoS)
 * que SheetJS solo corrigió en versiones posteriores distribuidas por fuera
 * de npm -- justo el vector de ataque relevante aquí, un archivo subido por
 * el usuario.
 */
function parseWithXls(buffer: Buffer): ParsedWorkbook {
  const workbook = XLS.read(buffer, { type: "buffer", cellDates: true });

  const sheets: SheetInfo[] = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const rowCount = XLS.utils.sheet_to_json<unknown[]>(sheet, { header: 1 }).length;
    return { name, rowCount };
  });

  return {
    sheets,
    getRows(sheetName: string): RawRow[] {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) throw new Error(`La hoja "${sheetName}" no existe en el archivo.`);

      const rawRows = XLS.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
      const rows: RawRow[] = [];
      for (const rawRow of rawRows) {
        const raw: RawRow = {};
        let hasValue = false;
        rawRow.forEach((cell, index) => {
          const value = xlsCellToValue(cell);
          if (value === null) return;
          raw[index] = value;
          hasValue = true;
        });
        if (hasValue) rows.push(raw);
      }
      return rows;
    },
  };
}

export async function parseWorkbook(buffer: Buffer, originalName: string): Promise<ParsedWorkbook> {
  const lowerName = originalName.toLowerCase();

  if (lowerName.endsWith(".csv")) return parseWithExcelJS(buffer, true);
  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xlsm")) return parseWithExcelJS(buffer, false);
  if (lowerName.endsWith(".xls")) return parseWithXls(buffer);

  throw new Error("Formato de archivo no soportado. Usa .xlsx, .xls, .xlsm o .csv.");
}
