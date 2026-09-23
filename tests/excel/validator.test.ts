import { describe, expect, it } from "vitest";
import { validateParsedRow } from "@/lib/excel/validator";

describe("validateParsedRow", () => {
  it("acepta precios positivos dentro de un rango realista", () => {
    expect(validateParsedRow({ originalProductName: "Producto", price: 5000, tax: null })).toEqual({ valid: true });
    expect(validateParsedRow({ originalProductName: "Producto", price: 11_000_000, tax: null })).toEqual({
      valid: true,
    });
  });

  it("rechaza precio 0 o negativo", () => {
    expect(validateParsedRow({ originalProductName: "Producto", price: 0, tax: null }).valid).toBe(false);
    expect(validateParsedRow({ originalProductName: "Producto", price: -100, tax: null }).valid).toBe(false);
  });

  it("rechaza un precio absurdamente alto en vez de dejar que la base de datos falle con overflow", () => {
    // Bug real (2026-09-23): una fila de Offimédicas con la cantidad del
    // empaque mal extraída multiplicaba el precio por unidad a un número
    // que no cabía en la columna de la base de datos ("numeric field
    // overflow" de Postgres), tumbando la importación completa de miles de
    // filas válidas. Ahora se rechaza como error de esa fila puntual.
    const result = validateParsedRow({ originalProductName: "Producto", price: 999_999_999_999, tax: null });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.message).toContain("absurdamente alto");
  });

  it("rechaza nombre de producto vacío", () => {
    expect(validateParsedRow({ originalProductName: "", price: 5000, tax: null }).valid).toBe(false);
  });
});
