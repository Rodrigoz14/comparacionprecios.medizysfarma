import { describe, expect, it } from "vitest";
import { detectDuplicates } from "@/lib/excel/duplicate-detector";
import type { ParsedOfferRow } from "@/lib/excel/types";

function row(overrides: Partial<ParsedOfferRow>): ParsedOfferRow {
  return {
    rowNumber: 1,
    supplierProductCode: null,
    originalProductName: "ACETAMINOFEN TAB 500MG X100",
    normalizedName: "acetaminofen 500 mg tableta x100 mk",
    genericKey: "acetaminofen 500 mg tableta",
    attributes: {
      activeIngredient: "ACETAMINOFEN",
      concentration: "500",
      concentrationUnit: "MG",
      dosageForm: "Tableta",
      presentationType: "Caja",
      presentationQuantity: 100,
      presentationUnit: "tabletas",
    },
    attributeWarnings: [],
    laboratoryName: "MK",
    price: 5000,
    unitPriceAsImported: null,
    tax: null,
    availability: "AVAILABLE",
    stock: null,
    expirationDate: null,
    ...overrides,
  };
}

describe("detectDuplicates", () => {
  it("agrupa filas repetidas con el mismo nombre Y el mismo código, conservando la última", () => {
    const rows = [row({ rowNumber: 1, price: 5000 }), row({ rowNumber: 2, price: 5200 })];
    const { unique, duplicateGroups } = detectDuplicates(rows);

    expect(unique).toHaveLength(1);
    expect(unique[0].rowNumber).toBe(2);
    expect(duplicateGroups).toHaveLength(1);
    expect(duplicateGroups[0].priceConflict).toBe(true);
  });

  it("NO agrupa filas con el mismo nombre pero código de proveedor distinto -- ambas se conservan", () => {
    // Bug real (2026-09-23): un mismo nombre de producto puede traer
    // variaciones reales (lote, registro...) que el texto no distingue,
    // pero el código del proveedor sí -- no deben descartarse como duplicadas.
    const rows = [
      row({ rowNumber: 1, supplierProductCode: "D100", price: 5000 }),
      row({ rowNumber: 2, supplierProductCode: "D200", price: 5200 }),
    ];
    const { unique, duplicateGroups } = detectDuplicates(rows);

    expect(unique).toHaveLength(2);
    expect(duplicateGroups).toHaveLength(0);
  });

  it("agrupa filas sin ningún código como antes (mismo tratamiento que código igual)", () => {
    const rows = [
      row({ rowNumber: 1, supplierProductCode: null, price: 5000 }),
      row({ rowNumber: 2, supplierProductCode: null, price: 5200 }),
    ];
    const { unique, duplicateGroups } = detectDuplicates(rows);

    expect(unique).toHaveLength(1);
    expect(duplicateGroups).toHaveLength(1);
  });
});
