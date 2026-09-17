import type { OfferOption } from "@/lib/pricing/types";

// Un genérico muy comprado (p. ej. acetaminofén) puede acumular decenas de
// ofertas entre todos los proveedores y presentaciones -- multiplicado por
// cada producto de una solicitud con muchas filas (un Excel grande), la
// respuesta completa podía llegar a varios MB y tumbar la pestaña del
// navegador al intentar renderizar todo (bug real: "This page couldn't
// load" al comparar precios de un archivo con muchos productos). Se limita
// a las alternativas más relevantes para mostrar (las más baratas primero),
// sin afectar la selección real ni lo que queda guardado en la base de
// datos -- lo que persiste en PriceComparison siempre usa la lista completa,
// esto solo recorta lo que se manda de vuelta al navegador.
const MAX_ALTERNATIVES_IN_RESPONSE = 20;

export function capAlternatives(alternatives: OfferOption[], selected: OfferOption | null): OfferOption[] {
  if (alternatives.length <= MAX_ALTERNATIVES_IN_RESPONSE) return alternatives;

  const sorted = [...alternatives].sort((a, b) => a.totalCost - b.totalCost);
  const capped = sorted.slice(0, MAX_ALTERNATIVES_IN_RESPONSE);
  if (selected && !capped.some((o) => o.supplierOfferId === selected.supplierOfferId)) {
    capped.push(selected);
  }
  return capped;
}
