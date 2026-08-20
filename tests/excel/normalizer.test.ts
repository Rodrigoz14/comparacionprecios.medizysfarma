import { describe, expect, it } from "vitest";
import { detectPriceFormat, normalizeAvailability, parsePrice } from "@/lib/excel/normalizer";

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
