/**
 * Cálculos financieros determinísticos: la IA nunca calcula totales ni ahorros
 * (Sección 6.32). Estas son las únicas funciones que multiplican precios.
 */
export function calculateTotal(unitPrice: number, quantity: number): number {
  return Math.round(unitPrice * quantity * 100) / 100;
}

export function calculateSavings(selectedUnitPrice: number, mostExpensiveUnitPrice: number, quantity: number): number {
  return calculateTotal(mostExpensiveUnitPrice - selectedUnitPrice, quantity);
}
