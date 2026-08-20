import { describe, expect, it } from "vitest";
import { calculateSavings, calculateTotal } from "@/lib/pricing/price-calculator";

describe("calculateTotal", () => {
  it("multiplica precio unitario por cantidad", () => {
    expect(calculateTotal(10000, 20)).toBe(200000);
  });

  it("redondea a 2 decimales", () => {
    expect(calculateTotal(10.005, 3)).toBe(30.02);
  });
});

describe("calculateSavings", () => {
  it("calcula el ahorro frente a la oferta mas cara", () => {
    expect(calculateSavings(9800, 10500, 20)).toBe(14000);
  });

  it("es cero cuando la seleccionada es la mas cara", () => {
    expect(calculateSavings(10500, 10500, 20)).toBe(0);
  });
});
