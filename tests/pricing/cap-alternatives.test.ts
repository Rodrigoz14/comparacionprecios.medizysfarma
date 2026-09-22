import { describe, expect, it } from "vitest";
import { capAlternatives } from "@/lib/pricing/cap-alternatives";
import type { OfferOption } from "@/lib/pricing/types";

function makeOffer(id: string, totalCost: number): OfferOption {
  return {
    supplierOfferId: id,
    supplierId: `supplier-${id}`,
    supplierName: `Proveedor ${id}`,
    productId: `product-${id}`,
    laboratoryName: null,
    packageSize: 100,
    presentationUnit: "tabletas",
    packagePrice: totalCost,
    unitPrice: totalCost / 100,
    packagesNeeded: 1,
    totalCost,
    availability: "AVAILABLE",
    stockQuantity: 10,
    expirationDate: null,
    eligible: true,
    discardReason: null,
  };
}

describe("capAlternatives", () => {
  it("no recorta cuando ya hay pocas alternativas", () => {
    const offers = [makeOffer("a", 100), makeOffer("b", 200)];
    expect(capAlternatives(offers, offers[0])).toHaveLength(2);
  });

  it("recorta a las mas baratas cuando hay muchas, evitando una respuesta gigante", () => {
    const offers = Array.from({ length: 200 }, (_, i) => makeOffer(`o${i}`, 1000 - i));
    const capped = capAlternatives(offers, null);
    expect(capped.length).toBeLessThan(offers.length);
    expect(capped.length).toBeLessThanOrEqual(21);
    // Las mas baratas (mayor i, menor totalCost) deben quedar, no las primeras del arreglo original.
    expect(capped.some((o) => o.supplierOfferId === "o199")).toBe(true);
  });

  it("siempre incluye la oferta seleccionada aunque no este entre las mas baratas", () => {
    const offers = Array.from({ length: 200 }, (_, i) => makeOffer(`o${i}`, i)); // o0 es la mas barata
    const selected = offers[199]; // la mas cara, fuera del recorte normal
    const capped = capAlternatives(offers, selected);
    expect(capped.some((o) => o.supplierOfferId === selected.supplierOfferId)).toBe(true);
  });
});
