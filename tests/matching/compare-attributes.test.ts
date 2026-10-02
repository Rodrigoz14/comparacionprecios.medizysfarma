import { describe, expect, it } from "vitest";
import { compareAttributes } from "@/lib/matching/compare-attributes";
import type { CandidateProduct, ExtractedAttributes } from "@/lib/matching/types";

function attrs(overrides: Partial<ExtractedAttributes>): ExtractedAttributes {
  return {
    activeIngredient: "AMPICILINA + SULBACTAM",
    concentration: "1.5",
    concentrationUnit: "G",
    dosageForm: "Inyectable",
    presentationType: "Caja",
    presentationQuantity: 10,
    presentationUnit: "ampollas",
    ...overrides,
  };
}

function candidate(overrides: Partial<CandidateProduct>): CandidateProduct {
  return {
    id: "p1",
    standardName: "AMPICILINA+SULBACTAM 1G+0.5G POL LIOF INY C*10 VIAL",
    normalizedName: "x",
    genericKey: "ampicilina sulbactam 1/0.5 g inyectable",
    activeIngredient: "AMPICILINA + SULBACTAM",
    concentration: "1/0.5",
    concentrationUnit: "G",
    dosageForm: "Inyectable",
    presentationType: "Caja",
    presentationQuantity: 10,
    presentationUnit: "ampollas",
    laboratoryId: null,
    ...overrides,
  };
}

describe("compareAttributes", () => {
  it("bug real (2026-10-02): la dosis TOTAL de un combinado ('1.5G') coincide con la misma dosis separada por principio ('1/0.5')", () => {
    // Confirmado en datos reales de producción: un cliente pide "AMPICILINA
    // SODICA + SULBACTAM SODICO... 1.5G VIAL" (dosis total, sin separar por
    // principio) y el catálogo lo guarda como "1G+0.5G" ("1/0.5") -- son el
    // mismo medicamento, 1g de ampicilina + 0.5g de sulbactam = 1.5g total.
    const comparison = compareAttributes(attrs({ concentration: "1.5" }), candidate({ concentration: "1/0.5" }));
    expect(comparison.concentrationMatch).toBe(true);
  });

  it("tambien funciona al reves: catalogo con dosis total, cliente pidiendo separado por principio", () => {
    const comparison = compareAttributes(attrs({ concentration: "1/0.5" }), candidate({ concentration: "1.5" }));
    expect(comparison.concentrationMatch).toBe(true);
  });

  it("una dosis total que NO coincide con la suma sigue sin ser un match", () => {
    const comparison = compareAttributes(attrs({ concentration: "2" }), candidate({ concentration: "1/0.5" }));
    expect(comparison.concentrationMatch).toBe(false);
  });

  it("NUNCA suma cuando la unidad ya es compuesta (dosis/volumen de una forma sellada, no dos principios)", () => {
    // Bug potencial que se evita a propósito: "BACLOFENO 10MG/20ML" (10mg en
    // 20ml, dosis/volumen de UNA presentación) no debe confundirse con una
    // suma de "30" -- "10/20" aquí no son dos principios activos.
    const comparison = compareAttributes(
      attrs({ activeIngredient: "BACLOFENO", concentration: "30", concentrationUnit: "MG/ML" }),
      candidate({
        activeIngredient: "BACLOFENO",
        concentration: "10/20",
        concentrationUnit: "MG/ML",
        standardName: "BACLOFENO 10MG/20ML SOLUCION INYECTABLE",
      }),
    );
    expect(comparison.concentrationMatch).toBe(false);
  });
});
