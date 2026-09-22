import { describe, expect, it } from "vitest";
import { isExpiringSoon, MIN_SAFE_EXPIRATION_MONTHS } from "@/lib/pricing/expiration";

const NOW = new Date("2026-09-22T00:00:00Z");

function monthsFromNow(months: number): Date {
  const date = new Date(NOW);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date;
}

describe("isExpiringSoon", () => {
  it("es false cuando no hay fecha de vencimiento", () => {
    expect(isExpiringSoon(null, NOW)).toBe(false);
  });

  it(`es true cuando faltan ${MIN_SAFE_EXPIRATION_MONTHS} meses o menos`, () => {
    expect(isExpiringSoon(monthsFromNow(12), NOW)).toBe(true);
    expect(isExpiringSoon(monthsFromNow(3), NOW)).toBe(true);
    expect(isExpiringSoon(monthsFromNow(-1), NOW)).toBe(true); // ya vencido
  });

  it(`es false cuando faltan más de ${MIN_SAFE_EXPIRATION_MONTHS} meses`, () => {
    expect(isExpiringSoon(monthsFromNow(13), NOW)).toBe(false);
    expect(isExpiringSoon(monthsFromNow(24), NOW)).toBe(false);
  });
});
