import { isMeasureUnit } from "@/lib/pricing/measured-forms";

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

/**
 * Cuando el cliente SÍ mencionó un tamaño de envase en el texto de su pedido
 * (p. ej. "TAB X30" o "JBE X30ML" -- requestedPresentationQuantity no nulo),
 * "cantidad solicitada" siempre significa número de ESOS envases, sin
 * importar la forma farmacéutica -- por eso ese caso sigue resolviéndose
 * igual que antes con calculatePackagesNeededMeasured (caja de 30 tabletas
 * vs. caja de 100 se comparan por costo total real, mismo criterio que un
 * frasco de jarabe de 30ml vs. uno de 15ml).
 *
 * Cuando el cliente NO mencionó ningún tamaño, el significado de "cantidad
 * solicitada" sí depende de la forma: para formas MEDIDAS (jarabe, crema...
 * -- ver isMeasureUnit) se sigue asumiendo esa cantidad de envases tal cual
 * vengan (no hay unidad suelta que contar). Pero para formas de UNIDADES
 * SUELTAS (tabletas, cápsulas, óvulos...) esa cantidad es un conteo de
 * unidades sueltas (p. ej. "9000 tabletas"), no de cajas -- confirmado con
 * el cliente (2026-09-24): antes se trataba ese número directamente como
 * cantidad de EMPAQUES a comprar, comprando cientos de veces más de lo
 * necesario (bug real: 9000 tabletas de Losartán, empaque de 300, terminaba
 * pidiendo 6300 empaques de 300 en vez de 21). Ampollas/viales sellados no
 * pasan por aquí: su cantidad de empaques se resuelve aparte (ver
 * isSealedUnitForm en cada punto de llamada).
 */
export function resolvePackagesNeeded(
  quantityToPurchase: number,
  requestedPresentationQuantity: number | null,
  offerPackageSize: number,
  presentationUnit: string,
): number {
  if (requestedPresentationQuantity === null && !isMeasureUnit(presentationUnit)) {
    return calculatePackagesNeeded(quantityToPurchase, offerPackageSize);
  }
  return calculatePackagesNeededMeasured(quantityToPurchase, requestedPresentationQuantity, offerPackageSize);
}

export function calculateTotal(packagePrice: number, packagesNeeded: number): number {
  return Math.round(packagePrice * packagesNeeded * 100) / 100;
}

export function calculateSavings(selectedTotalCost: number, mostExpensiveTotalCost: number): number {
  return Math.round((mostExpensiveTotalCost - selectedTotalCost) * 100) / 100;
}
