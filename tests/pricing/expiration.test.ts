import { describe, expect, it } from "vitest";
import { isSafeExpirationLabel } from "@/lib/pricing/expiration";

describe("isSafeExpirationLabel", () => {
  it('es true solo para "SUPERIOR A 12 MESES" (sin importar mayúsculas/espacios)', () => {
    expect(isSafeExpirationLabel("SUPERIOR A 12 MESES")).toBe(true);
    expect(isSafeExpirationLabel("superior a 12 meses")).toBe(true);
    expect(isSafeExpirationLabel("Superior a 12 Meses")).toBe(true);
  });

  it('es false para cualquier "FECHA CORTA <mes>"', () => {
    expect(isSafeExpirationLabel("FECHA CORTA MAYO")).toBe(false);
    expect(isSafeExpirationLabel("FECHA CORTA ENERO")).toBe(false);
    expect(isSafeExpirationLabel("Fecha corta diciembre")).toBe(false);
  });

  it("es false cuando no hay categoría (sin dato, se trata como riesgo)", () => {
    expect(isSafeExpirationLabel(null)).toBe(false);
    expect(isSafeExpirationLabel("")).toBe(false);
  });

  it("es false para texto no reconocido", () => {
    expect(isSafeExpirationLabel("N/A")).toBe(false);
  });
});
