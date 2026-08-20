import { describe, expect, it } from "vitest";
import { fuzzyIngredientThreshold, levenshteinDistance } from "@/lib/matching/fuzzy";

describe("levenshteinDistance", () => {
  it("es 0 para textos identicos", () => {
    expect(levenshteinDistance("acido valproico", "acido valproico")).toBe(0);
  });

  it("cuenta una sola sustitucion/borrado para un typo tipico", () => {
    // Caso real reportado por el cliente: "valprico" en vez de "valproico".
    expect(levenshteinDistance("valproico", "valprico")).toBe(1);
  });

  it("crece con la cantidad de diferencias", () => {
    expect(levenshteinDistance("acetaminofen", "ibuprofeno")).toBeGreaterThan(3);
  });
});

describe("fuzzyIngredientThreshold", () => {
  it("da mas tolerancia a textos largos que a textos cortos", () => {
    expect(fuzzyIngredientThreshold("acido valproico".length)).toBeGreaterThan(fuzzyIngredientThreshold("sal".length));
  });

  it("nunca es cero: siempre tolera al menos un error", () => {
    expect(fuzzyIngredientThreshold(1)).toBeGreaterThanOrEqual(1);
  });
});
