import { describe, expect, it } from "vitest";
import { findSupplierProfile, isZeroStockValue, resolveFixedMapping } from "@/lib/excel/supplier-profiles";
import type { RawRow } from "@/lib/excel/types";

function headerRow(...values: string[]): RawRow {
  const raw: RawRow = {};
  values.forEach((v, i) => {
    raw[i] = v;
  });
  return raw;
}

describe("findSupplierProfile", () => {
  it("reconoce Disfarma, Ramédicas y Offimédicas sin importar mayúsculas/acentos ni texto alrededor", () => {
    expect(findSupplierProfile("Disfarma")?.key).toBe("disfarma");
    expect(findSupplierProfile("DISFARMA S.A.S")?.key).toBe("disfarma");
    expect(findSupplierProfile("Ramédicas")?.key).toBe("ramedicas");
    expect(findSupplierProfile("ramedicas")?.key).toBe("ramedicas");
    expect(findSupplierProfile("Offimédicas")?.key).toBe("offimedicas");
    expect(findSupplierProfile("OFFIMEDICAS")?.key).toBe("offimedicas");
  });

  it("no reconoce un proveedor sin perfil fijo", () => {
    expect(findSupplierProfile("Distribuidora Genérica")).toBeNull();
  });
});

describe("resolveFixedMapping (Disfarma)", () => {
  const profile = findSupplierProfile("Disfarma")!;

  it("ubica cada columna por su nombre exacto, sin importar guiones bajos/mayúsculas", () => {
    const row = headerRow(
      "codigo",
      "descripcion",
      "ger_ups_und",
      "forma_farmaceutica",
      "presentacion",
      "laboratorio",
      "columna sobrante",
    );
    const { mapping, missingColumns } = resolveFixedMapping(profile, row);

    expect(mapping.supplierProductCode).toBe(0);
    expect(mapping.productName).toBe(1);
    expect(mapping.price).toBe(2);
    expect(mapping.dosageForm).toBe(3);
    expect(mapping.presentation).toBe(4);
    expect(mapping.laboratory).toBe(5);
    expect(missingColumns).toEqual([]);
    // La columna sobrante no se mapea a nada -- "las demás columnas no se van a tomar".
    expect(Object.values(mapping)).not.toContain(6);
  });

  it("reporta las columnas esperadas que no vienen en el archivo", () => {
    const row = headerRow("CODIGO", "DESCRIPCION");
    const { mapping, missingColumns } = resolveFixedMapping(profile, row);

    expect(mapping.supplierProductCode).toBe(0);
    expect(mapping.productName).toBe(1);
    expect(mapping.price).toBeUndefined();
    expect(missingColumns).toContain("Ger_UPS_UND");
    expect(missingColumns).toContain("FORMA_FARMACEUTICA");
  });
});

describe("resolveFixedMapping (Ramédicas)", () => {
  it("ubica las columnas propias de Ramédicas, incluyendo STOCK ACTUAL", () => {
    const profile = findSupplierProfile("Ramedicas")!;
    const row = headerRow(
      "CODIGO INTERNO MEDICAMENTO",
      "DESCRIPCION COMPLETA DE PRODUCTO",
      "PRESENTACION",
      "PRECIO X UD",
      "LABORATORIO",
      "STOCK ACTUAL",
    );
    const { mapping, missingColumns } = resolveFixedMapping(profile, row);

    expect(mapping.supplierProductCode).toBe(0);
    expect(mapping.productName).toBe(1);
    expect(mapping.presentation).toBe(2);
    expect(mapping.price).toBe(3);
    expect(mapping.laboratory).toBe(4);
    expect(mapping.stock).toBe(5);
    expect(missingColumns).toEqual([]);
    expect(profile.excludeZeroStock).toBe(true);
    expect(profile.priceIsPerUnit).toBe(true);
  });
});

describe("resolveFixedMapping (Offimédicas)", () => {
  it("ubica las columnas propias de Offimédicas, usando CANTIDAD como stock", () => {
    const profile = findSupplierProfile("Offimedicas")!;
    const row = headerRow("ID_PRODUCTO", "PRODUCTO", "LABORATORIO", "CANTIDAD", "PRECIO UND");
    const { mapping } = resolveFixedMapping(profile, row);

    expect(mapping.supplierProductCode).toBe(0);
    expect(mapping.productName).toBe(1);
    expect(mapping.laboratory).toBe(2);
    expect(mapping.stock).toBe(3);
    expect(mapping.price).toBe(4);
    expect(profile.excludeZeroStock).toBe(true);
  });
});

describe("isZeroStockValue", () => {
  it("trata 0 (numero o texto) como sin existencia", () => {
    expect(isZeroStockValue(0)).toBe(true);
    expect(isZeroStockValue("0")).toBe(true);
    expect(isZeroStockValue(-5)).toBe(true);
  });

  it("no excluye cantidades positivas ni valores vacíos/no numéricos", () => {
    expect(isZeroStockValue(10)).toBe(false);
    expect(isZeroStockValue("10")).toBe(false);
    expect(isZeroStockValue(null)).toBe(false);
    expect(isZeroStockValue(undefined)).toBe(false);
    expect(isZeroStockValue("SI")).toBe(false);
  });
});
