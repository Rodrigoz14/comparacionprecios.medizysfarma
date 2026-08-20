import { describe, expect, it } from "vitest";
import { calculatePackagesNeeded, calculateSavings, calculateTotal } from "@/lib/pricing/price-calculator";

describe("calculatePackagesNeeded", () => {
  it("redondea hacia arriba: no se compran unidades sueltas", () => {
    expect(calculatePackagesNeeded(90, 30)).toBe(3);
    expect(calculatePackagesNeeded(91, 30)).toBe(4);
  });

  it("una sola caja alcanza cuando el pedido cabe exacto", () => {
    expect(calculatePackagesNeeded(30, 30)).toBe(1);
  });
});

describe("calculateTotal", () => {
  it("multiplica precio del empaque por empaques necesarios", () => {
    expect(calculateTotal(10000, 20)).toBe(200000);
  });

  it("redondea a 2 decimales", () => {
    expect(calculateTotal(10.005, 3)).toBe(30.02);
  });
});

describe("calculateSavings", () => {
  it("calcula el ahorro frente a la oferta mas cara (ambas en costo total)", () => {
    expect(calculateSavings(9800, 10500)).toBe(700);
  });

  it("es cero cuando la seleccionada es la mas cara", () => {
    expect(calculateSavings(10500, 10500)).toBe(0);
  });
});
