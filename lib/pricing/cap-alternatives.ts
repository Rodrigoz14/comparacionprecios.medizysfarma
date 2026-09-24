import type { OfferOption } from "@/lib/pricing/types";

// Un genérico muy comprado (p. ej. acetaminofén) puede acumular decenas de
// ofertas entre todos los proveedores y presentaciones -- multiplicado por
// cada producto de una solicitud con muchas filas (un Excel grande), la
// respuesta completa podía llegar a varios MB y tumbar la pestaña del
// navegador al intentar renderizar todo (bug real: "This page couldn't
// load" al comparar precios de un archivo con muchos productos). Se limita
// a las alternativas más relevantes para mostrar, sin afectar la selección
// real ni lo que queda guardado en la base de datos -- lo que persiste en
// PriceComparison siempre usa la lista completa, esto solo recorta lo que
// se manda de vuelta al navegador.
const MAX_ALTERNATIVES_IN_RESPONSE = 20;

// Las ofertas consideradas se muestran siempre de menor a mayor PRECIO
// UNITARIO (no precio total) -- confirmado con el cliente (2026-09-24):
// es la referencia que compara ofertas de distinto tamaño de empaque entre
// sí. Se ordena siempre, no solo cuando hay que recortar por volumen.
export function capAlternatives(alternatives: OfferOption[], selected: OfferOption | null): OfferOption[] {
  const sorted = [...alternatives].sort((a, b) => a.unitPrice - b.unitPrice);
  if (sorted.length <= MAX_ALTERNATIVES_IN_RESPONSE) return sorted;

  const capped = sorted.slice(0, MAX_ALTERNATIVES_IN_RESPONSE);
  if (selected && !capped.some((o) => o.supplierOfferId === selected.supplierOfferId)) {
    capped.push(selected);
  }
  return capped;
}
