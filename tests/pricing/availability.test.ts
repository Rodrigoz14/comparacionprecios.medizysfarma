import { describe, expect, it } from "vitest";
import { checkAvailability } from "@/lib/pricing/availability";

describe("checkAvailability", () => {
  it("rechaza ofertas agotadas", () => {
    expect(checkAvailability("OUT_OF_STOCK", 0, 10).eligible).toBe(false);
  });

  it("rechaza disponibilidad desconocida (nunca asume)", () => {
    expect(checkAvailability("UNKNOWN", null, 10).eligible).toBe(false);
  });

  it("rechaza cuando el stock reportado es menor a lo solicitado", () => {
    const result = checkAvailability("AVAILABLE", 5, 10);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/insuficiente/);
  });

  it("acepta cuando el stock alcanza o supera lo solicitado", () => {
    expect(checkAvailability("AVAILABLE", 10, 10).eligible).toBe(true);
    expect(checkAvailability("AVAILABLE", 50, 10).eligible).toBe(true);
  });

  it("acepta disponible sin cantidad reportada (confia en la bandera del proveedor)", () => {
    expect(checkAvailability("AVAILABLE", null, 10).eligible).toBe(true);
  });
});
