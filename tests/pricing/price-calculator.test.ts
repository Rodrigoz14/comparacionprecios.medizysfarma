import { describe, expect, it } from "vitest";
import { calculatePackagesNeeded, calculateSavings, calculateTotal, resolvePackagesNeeded } from "@/lib/pricing/price-calculator";

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

  it("con tamaño mencionado, una forma medida sigue comparando por volumen/peso total real", () => {
    // Pidió 2 frascos x30ml (= 60ml); una oferta de frascos de 15ml necesita 4.
    expect(resolvePackagesNeeded(2, 30, 15, "ml")).toBe(4);
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
