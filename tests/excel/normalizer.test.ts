import { describe, expect, it } from "vitest";
import {
  buildNormalizedName,
  detectPriceFormat,
  extractProductAttributes,
  normalizeAvailability,
  parsePrice,
} from "@/lib/excel/normalizer";

describe("parsePrice", () => {
  it("parsea formato colombiano con miles en punto y decimales en coma", () => {
    expect(parsePrice("$ 10.500,00", { thousands: ".", decimal: "," })).toBe(10500);
    expect(parsePrice("10.500", { thousands: ".", decimal: "," })).toBe(10500);
  });

  it("parsea formato internacional con miles en coma y decimales en punto", () => {
    expect(parsePrice("10,500.50", { thousands: ",", decimal: "." })).toBe(10500.5);
  });

  it("parsea numeros planos sin separador de miles", () => {
    expect(parsePrice("10500", { thousands: "none", decimal: "." })).toBe(10500);
    expect(parsePrice("10500.75", { thousands: "none", decimal: "." })).toBe(10500.75);
  });

  it("acepta valores numericos directamente", () => {
    expect(parsePrice(9800, { thousands: ".", decimal: "," })).toBe(9800);
  });

  it("devuelve null para valores no interpretables", () => {
    expect(parsePrice("", { thousands: ".", decimal: "," })).toBeNull();
    expect(parsePrice(null, { thousands: ".", decimal: "," })).toBeNull();
    expect(parsePrice("N/A", { thousands: ".", decimal: "," })).toBeNull();
  });
});

describe("detectPriceFormat", () => {
  it("detecta formato colombiano cuando hay punto y coma juntos", () => {
    expect(detectPriceFormat(["$10.500,00", "9.800,50"])).toEqual({ thousands: ".", decimal: "," });
  });

  it("detecta formato internacional cuando la coma esta antes del punto", () => {
    expect(detectPriceFormat(["10,500.00"])).toEqual({ thousands: ",", decimal: "." });
  });

  it("asume miles en punto cuando solo aparece coma", () => {
    expect(detectPriceFormat(["10500,50", "9800,00"])).toEqual({ thousands: ".", decimal: "," });
  });

  it("detecta decimal en punto cuando el patron es consistente con 2 decimales", () => {
    expect(detectPriceFormat(["10500.00", "9800.50", "12000.75"])).toEqual({ thousands: "none", decimal: "." });
  });

  it("por defecto usa convencion colombiana sin muestras claras", () => {
    expect(detectPriceFormat([])).toEqual({ thousands: ".", decimal: "," });
  });
});

describe("normalizeAvailability", () => {
  it("interpreta texto afirmativo como disponible", () => {
    expect(normalizeAvailability("Sí").availability).toBe("AVAILABLE");
    expect(normalizeAvailability("DISPONIBLE").availability).toBe("AVAILABLE");
    expect(normalizeAvailability("SI").availability).toBe("AVAILABLE");
  });

  it("interpreta texto negativo como agotado", () => {
    expect(normalizeAvailability("Agotado")).toEqual({ availability: "OUT_OF_STOCK", stock: 0 });
    expect(normalizeAvailability("NO").availability).toBe("OUT_OF_STOCK");
  });

  it("interpreta cantidades numericas como stock", () => {
    expect(normalizeAvailability(50)).toEqual({ availability: "AVAILABLE", stock: 50 });
    expect(normalizeAvailability(0)).toEqual({ availability: "OUT_OF_STOCK", stock: 0 });
    expect(normalizeAvailability("50")).toEqual({ availability: "AVAILABLE", stock: 50 });
  });

  it("devuelve desconocido para texto no interpretable", () => {
    expect(normalizeAvailability("???").availability).toBe("UNKNOWN");
    expect(normalizeAvailability(undefined).availability).toBe("UNKNOWN");
  });
});

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
    expect(buildNormalizedName(x100!.attributes)).not.toBe(buildNormalizedName(x20!.attributes));
  });

  it("devuelve null cuando no hay concentracion ni presentacion reconocibles", () => {
    expect(extractProductAttributes("PRODUCTO SIN DATOS CLAROS")).toBeNull();
  });

  it("devuelve null cuando falta la unidad de concentracion (evita adivinar)", () => {
    expect(extractProductAttributes("AMOXICILINA 500/125 X21")).toBeNull();
  });
});

describe("buildNormalizedName", () => {
  it("produce el mismo nombre normalizado para variantes de escritura equivalentes", () => {
    const a = extractProductAttributes("ACETAMINOFEN TAB 500MG X100");
    const b = extractProductAttributes("Acetaminofen tableta 500 mg x 100");
    expect(buildNormalizedName(a!.attributes)).toBe(buildNormalizedName(b!.attributes));
  });
});
