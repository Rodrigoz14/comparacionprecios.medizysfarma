/**
 * Cálculos financieros determinísticos: la IA nunca calcula totales ni ahorros
 * (Sección 6.32). No se compran unidades sueltas: siempre se redondea hacia
 * arriba a empaques completos.
 */
export function calculatePackagesNeeded(requestedQuantity: number, packageSize: number): number {
  return Math.ceil(requestedQuantity / packageSize);
}

/**
 * Para formas medidas (jarabe, suspensión, crema, etc. -- presentationUnit
 * en ml/g): a diferencia de una tableta, "cantidad solicitada" significa
 * número de ENVASES pedidos, no unidades sueltas de la medida (Sección:
 * bug real reportado por el cliente -- pidió un jarabe de 30ml y el sistema
 * ofreció uno de 15ml sin darse cuenta de que hacían falta el doble).
 *
 * Si el cliente pidió un tamaño de envase específico, se puede comparar un
 * envase de otro tamaño por costo total (igual que una caja de tabletas de
 * 30 vs 100): el total necesario es quantityToPurchase envases del tamaño
 * pedido, y se calculan cuántos envases de ESTE tamaño hacen falta para
 * cubrir ese mismo volumen/peso total. Si no especificó ningún tamaño, no
 * hay base para esa conversión: se piden esa cantidad de envases tal cual
 * vengan, sin importar su tamaño individual.
 */
export function calculatePackagesNeededMeasured(
  quantityToPurchase: number,
  requestedPresentationQuantity: number | null,
  offerPackageSize: number,
): number {
  if (requestedPresentationQuantity === null) {
    return quantityToPurchase;
  }
  const totalNeeded = quantityToPurchase * requestedPresentationQuantity;
  return calculatePackagesNeeded(totalNeeded, offerPackageSize);
}

export function calculateTotal(packagePrice: number, packagesNeeded: number): number {
  return Math.round(packagePrice * packagesNeeded * 100) / 100;
}

export function calculateSavings(selectedTotalCost: number, mostExpensiveTotalCost: number): number {
  return Math.round((mostExpensiveTotalCost - selectedTotalCost) * 100) / 100;
}
