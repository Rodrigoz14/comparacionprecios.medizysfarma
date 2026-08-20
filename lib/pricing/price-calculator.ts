/**
 * Cálculos financieros determinísticos: la IA nunca calcula totales ni ahorros
 * (Sección 6.32). No se compran unidades sueltas: siempre se redondea hacia
 * arriba a empaques completos.
 */
export function calculatePackagesNeeded(requestedQuantity: number, packageSize: number): number {
  return Math.ceil(requestedQuantity / packageSize);
}

export function calculateTotal(packagePrice: number, packagesNeeded: number): number {
  return Math.round(packagePrice * packagesNeeded * 100) / 100;
}

export function calculateSavings(selectedTotalCost: number, mostExpensiveTotalCost: number): number {
  return Math.round((mostExpensiveTotalCost - selectedTotalCost) * 100) / 100;
}
