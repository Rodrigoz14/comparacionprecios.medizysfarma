import { describe, expect, it } from "vitest";
import { detectColumns, detectHeaderRowIndex } from "@/lib/excel/detector";
import type { RawRow } from "@/lib/excel/types";

describe("detectHeaderRowIndex", () => {
  it("encuentra la fila de encabezados aunque haya una fila de titulo antes", () => {
    const rows: RawRow[] = [
      { 0: "Lista de precios Ramédicas" },
      { 0: "CODIGO", 1: "DESCRIPCION", 2: "LABORATORIO", 3: "PRECIO", 4: "EXISTENCIA" },
      { 0: "12345", 1: "ACETAMINOFEN TAB 500MG X100", 2: "GENFAR", 3: "10500", 4: "SI" },
    ];
    expect(detectHeaderRowIndex(rows)).toBe(1);
  });
});

describe("detectColumns", () => {
  it("mapea encabezados de Ramédicas a los campos estandar", () => {
    const header: RawRow = { 0: "CODIGO", 1: "DESCRIPCION", 2: "LABORATORIO", 3: "PRECIO", 4: "EXISTENCIA" };
    const columns = detectColumns(header);
    const byTarget = Object.fromEntries(columns.map((c) => [c.proposedTarget, c.index]));
    expect(byTarget.supplierProductCode).toBe(0);
    expect(byTarget.productName).toBe(1);
    expect(byTarget.laboratory).toBe(2);
    expect(byTarget.price).toBe(3);
  });

  it("mapea encabezados de Disfarma (nombres distintos) a los mismos campos estandar", () => {
    const header: RawRow = { 0: "SKU", 1: "DESCRIPCION", 2: "MARCA", 3: "VALOR", 4: "EXISTENCIA" };
    const columns = detectColumns(header);
    const byTarget = Object.fromEntries(columns.map((c) => [c.proposedTarget, c.index]));
    expect(byTarget.supplierProductCode).toBe(0);
    expect(byTarget.productName).toBe(1);
    expect(byTarget.laboratory).toBe(2);
    expect(byTarget.price).toBe(3);
  });

  it("no asigna dos columnas al mismo campo", () => {
    const header: RawRow = { 0: "EXISTENCIA", 1: "STOCK" };
    const columns = detectColumns(header);
    const targets = columns.map((c) => c.proposedTarget).filter(Boolean);
    expect(new Set(targets).size).toBe(targets.length);
  });
});
