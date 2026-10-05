import { describe, expect, it } from "vitest";
import { buildGenericKey, buildGenericKeyAliases } from "@/lib/matching/normalize";

function attrs(overrides: { concentration: string; concentrationUnit: string; dosageForm?: string }) {
  return {
    activeIngredient: "LEVOTIROXINA",
    dosageForm: "Tableta",
    ...overrides,
  };
}

describe("buildGenericKeyAliases", () => {
  it("a pedido del cliente (2026-10-05): genera las claves equivalentes de un producto en otra escala de unidad, sin guardar nada extra", () => {
    // "100 MCG" y "0.1 MG" son la MISMA dosis real -- un proveedor que
    // escriba una y otro la otra deben encontrarse entre sí.
    const mcg = attrs({ concentration: "100", concentrationUnit: "MCG" });
    const mg = attrs({ concentration: "0.1", concentrationUnit: "MG" });
    expect(buildGenericKeyAliases(mcg)).toContain(buildGenericKey(mg));
    expect(buildGenericKeyAliases(mg)).toContain(buildGenericKey(mcg));
  });

  it("MG <-> G en ambas direcciones", () => {
    const mg = attrs({ concentration: "500", concentrationUnit: "MG" });
    const g = attrs({ concentration: "0.5", concentrationUnit: "G" });
    expect(buildGenericKeyAliases(mg)).toContain(buildGenericKey(g));
    expect(buildGenericKeyAliases(g)).toContain(buildGenericKey(mg));
  });

  it("nunca genera un alias igual a la clave principal", () => {
    const mg = attrs({ concentration: "1000", concentrationUnit: "MG" });
    expect(buildGenericKeyAliases(mg)).not.toContain(buildGenericKey(mg));
  });

  it("NUNCA convierte '%' <-> 'MG' -- % es una tasa (por 100ml/100g), MG simple es contenido total, no son convertibles sin saber el volumen", () => {
    // Confirmado durante el desarrollo: "500MG" en un frasco de 250ml NO es
    // "5%" (serían en realidad 2 mg/ml = 0.2%, no 5%) -- generar ese alias
    // habría producido coincidencias matemáticamente incorrectas.
    const pct = attrs({ concentration: "1", concentrationUnit: "%", dosageForm: "Solución" });
    const mg = attrs({ concentration: "10", concentrationUnit: "MG", dosageForm: "Solución" });
    expect(buildGenericKeyAliases(pct)).toEqual([]);
    expect(buildGenericKeyAliases(mg)).not.toContain(buildGenericKey(pct));
  });

  it("NUNCA genera alias para combinados de 2 principios ('1/0.5') -- convertir fusionaría productos reales distintos", () => {
    const combo = { activeIngredient: "AMPICILINA + SULBACTAM", dosageForm: "Inyectable", concentration: "1/0.5", concentrationUnit: "G" };
    expect(buildGenericKeyAliases(combo)).toEqual([]);
  });

  it("NUNCA genera alias para una razon dosis/volumen de una forma sellada ('10/20' de Baclofeno) -- mismo motivo que el fix de Baclofeno/Enoxaparina", () => {
    const baclofeno = { activeIngredient: "BACLOFENO", dosageForm: "Inyectable", concentration: "10/20", concentrationUnit: "MG/ML" };
    expect(buildGenericKeyAliases(baclofeno)).toEqual([]);
  });
});
