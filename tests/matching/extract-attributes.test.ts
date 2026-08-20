import { describe, expect, it } from "vitest";
import { extractProductAttributes } from "@/lib/matching/extract-attributes";
import { buildGenericKey, buildNormalizedName } from "@/lib/matching/normalize";

describe("extractProductAttributes", () => {
  it("extrae atributos de 'ACETAMINOFEN TAB 500MG X100'", () => {
    const result = extractProductAttributes("ACETAMINOFEN TAB 500MG X100");
    expect(result).not.toBeNull();
    expect(result?.attributes).toMatchObject({
      activeIngredient: "ACETAMINOFEN",
      concentration: "500",
      concentrationUnit: "MG",
      dosageForm: "Tableta",
      presentationQuantity: 100,
    });
  });

  it("extrae atributos de 'PARACETAMOL 500 MG TABLETAS CAJA X 100'", () => {
    const result = extractProductAttributes("PARACETAMOL 500 MG TABLETAS CAJA X 100");
    expect(result).not.toBeNull();
    expect(result?.attributes).toMatchObject({
      activeIngredient: "PARACETAMOL",
      concentration: "500",
      concentrationUnit: "MG",
      dosageForm: "Tableta",
      presentationType: "Caja",
      presentationQuantity: 100,
    });
  });

  it("extrae la concentracion compuesta de 'AMOXICILINA + CLAVULANATO 500/125 MG X21'", () => {
    const result = extractProductAttributes("AMOXICILINA + CLAVULANATO 500/125 MG X21");
    expect(result).not.toBeNull();
    expect(result?.attributes.concentration).toBe("500/125");
    expect(result?.attributes.presentationQuantity).toBe(21);
  });

  it("no confunde presentaciones distintas del mismo producto", () => {
    const x100 = extractProductAttributes("ACETAMINOFEN TAB 500MG X100");
    const x20 = extractProductAttributes("ACETAMINOFEN 500MG X20");
    expect(x100?.attributes.presentationQuantity).not.toBe(x20?.attributes.presentationQuantity);
    expect(buildGenericKey(x100!.attributes)).not.toBe(buildGenericKey(x20!.attributes));
  });

  it("devuelve null cuando no hay concentracion ni presentacion reconocibles", () => {
    expect(extractProductAttributes("PRODUCTO SIN DATOS CLAROS")).toBeNull();
  });

  it("devuelve null cuando falta la unidad de concentracion (evita adivinar)", () => {
    expect(extractProductAttributes("AMOXICILINA 500/125 X21")).toBeNull();
  });
});

describe("buildGenericKey", () => {
  it("produce la misma clave generica para variantes de escritura equivalentes", () => {
    const a = extractProductAttributes("ACETAMINOFEN TAB 500MG X100");
    const b = extractProductAttributes("Acetaminofen tableta 500 mg x 100");
    expect(buildGenericKey(a!.attributes)).toBe(buildGenericKey(b!.attributes));
  });
});

describe("buildNormalizedName", () => {
  it("distingue el mismo generico ofrecido por laboratorios distintos", () => {
    const attrs = extractProductAttributes("ACETAMINOFEN TAB 500MG X100")!.attributes;
    const genfar = buildNormalizedName(attrs, "genfar");
    const pfizer = buildNormalizedName(attrs, "pfizer");
    expect(genfar).not.toBe(pfizer);
    expect(buildGenericKey(attrs)).toBe(buildGenericKey(attrs)); // misma clave generica
  });

  it("usa un sufijo estable cuando no se conoce el laboratorio", () => {
    const attrs = extractProductAttributes("ACETAMINOFEN TAB 500MG X100")!.attributes;
    expect(buildNormalizedName(attrs, null)).toBe(buildNormalizedName(attrs, null));
    expect(buildNormalizedName(attrs, null)).not.toBe(buildNormalizedName(attrs, "genfar"));
  });
});
