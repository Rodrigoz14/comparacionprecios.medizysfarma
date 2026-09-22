// Confirmado con el cliente (2026-09-22): un producto que vence en 12 meses
// o menos ya no se considera "seguro" para recomendar comprar. Por ahora
// solo Disfarma reporta fecha de vencimiento (columna FEC_VENC), pero este
// umbral es independiente del proveedor -- lo usan tanto el motor de
// precios (selection-engine.ts) como la previsualización de Proveedores.
export const MIN_SAFE_EXPIRATION_MONTHS = 12;
const MS_PER_MONTH = (365.25 / 12) * 24 * 60 * 60 * 1000;

/** true cuando la fecha vence en MIN_SAFE_EXPIRATION_MONTHS meses o menos. */
export function isExpiringSoon(expirationDate: Date | null, now: Date = new Date()): boolean {
  if (!expirationDate) return false;
  const monthsUntilExpiration = (expirationDate.getTime() - now.getTime()) / MS_PER_MONTH;
  return monthsUntilExpiration <= MIN_SAFE_EXPIRATION_MONTHS;
}
