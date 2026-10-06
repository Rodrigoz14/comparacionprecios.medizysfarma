import { describe, expect, it } from "vitest";
import {
  calculatePackagesNeeded,
  calculateSavings,
  calculateTotal,
  resolvePackagesNeeded,
  resolveUnitPrice,
} from "@/lib/pricing/price-calculator";

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

describe("resolvePackagesNeeded", () => {
  it("bug real (2026-09-24): sin tamaño mencionado, tabletas son unidades sueltas, no empaques -- 9000 tabletas con empaque de 300 son 30 empaques, no 9000", () => {
    expect(resolvePackagesNeeded(9000, null, 300, "tabletas")).toBe(30);
  });

  it("sin tamaño mencionado, formas medidas (ml/g) siguen pidiéndose como esa cantidad de envases tal cual vengan", () => {
    expect(resolvePackagesNeeded(2, null, 30, "ml")).toBe(2);
    expect(resolvePackagesNeeded(2, null, 30, "ml")).not.toBe(calculatePackagesNeeded(2, 30));
  });

  it("con tamaño mencionado, cualquier forma se compara por contenido total real (caja de 30 vs caja de 100)", () => {
    // Pidió 3 cajas x30 (= 90 tabletas); una oferta que trae cajas de 100
    // solo necesita 1 caja, no 3.
    expect(resolvePackagesNeeded(3, 30, 100, "tabletas")).toBe(1);
  });

  it("a pedido del cliente (2026-10-06): en presentaciones medidas (ml/g) la cantidad son envases, el volumen del envase NO entra al total", () => {
    // Pidió 120 envases "x100 ml": son 120 envases, no 120 x 100 ml.
    expect(resolvePackagesNeeded(120, 100, 100, "ml")).toBe(120);
    expect(resolvePackagesNeeded(2, 30, 15, "ml")).toBe(2);
  });
});

describe("resolveUnitPrice", () => {
  it("usa el precio que el proveedor ya reportó, sin recalcular, cuando viene", () => {
    expect(resolveUnitPrice(141384, 24, true, 5891)).toBe(5891);
    expect(resolveUnitPrice(141384, 24, false, 5891)).toBe(5891);
  });

  it("bug real (2026-10-05): una forma sellada (Inyectable/Ampolla) medida en ml NUNCA se divide entre el tamaño del empaque -- el precio ya es de la caja sellada completa", () => {
    // Caja de 24ml a $141.384 -- el precio unitario de referencia debe ser
    // el precio de LA CAJA completa, nunca "$141.384/24 = $5.891" (eso
    // confundía una caja sellada con un jarabe fraccionable; ver
    // selection-engine.ts, exclude-offer/route.ts, select-offer/route.ts).
    expect(resolveUnitPrice(141384, 24, true, null)).toBe(141384);
  });

  it("a pedido del cliente (2026-10-06): una presentación medida en ml (aunque no sea sellada) tampoco se divide -- el precio es por envase", () => {
    // Acetaminofén 1g/100ml fco x12 a $7.470 por envase: el precio por
    // envase es $7.470, no $7.470/100 ml.
    expect(resolveUnitPrice(7470, 100, true, null)).toBe(7470);
  });

  it("una forma NO sellada (jarabe, solución...) sin precio unitario reportado sí se deriva por división", () => {
    expect(resolveUnitPrice(141384, 24, false, null)).toBe(5891);
  });

  it("redondea la división a 4 decimales", () => {
    expect(resolveUnitPrice(100, 3, false, null)).toBe(33.3333);
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
