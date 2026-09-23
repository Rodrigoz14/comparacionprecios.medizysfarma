import { describe, expect, it } from "vitest";
import { rankOffers } from "@/lib/pricing/supplier-ranking";
import type { OfferOption } from "@/lib/pricing/types";

function offer(overrides: Partial<OfferOption>): OfferOption {
  return {
    supplierOfferId: overrides.supplierId ?? "offer",
    supplierId: "supplier",
    supplierName: "Proveedor",
    productId: "product",
    laboratoryName: null,
    packageSize: 1,
    presentationUnit: "tableta",
    packagePrice: 100,
    unitPrice: 100,
    packagesNeeded: 1,
    totalCost: 100,
    availability: "AVAILABLE",
    stockQuantity: null,
    expirationLabel: null,
    eligible: true,
    discardReason: null,
    ...overrides,
  };
}

describe("rankOffers", () => {
  it("ordena por menor costo total cuando no hay proveedor preferido", () => {
    const offers = [
      offer({ supplierId: "a", totalCost: 200 }),
      offer({ supplierId: "b", totalCost: 100 }),
      offer({ supplierId: "c", totalCost: 150 }),
    ];
    const ranked = rankOffers(offers, { preferredSupplierId: null, preferredSupplierTolerance: 0.02 });
    expect(ranked.map((o) => o.supplierId)).toEqual(["b", "c", "a"]);
  });

  it("el proveedor preferido gana si esta dentro del margen de tolerancia", () => {
    const offers = [
      offer({ supplierId: "ramedicas", totalCost: 10000 }),
      offer({ supplierId: "disfarma", totalCost: 9900 }),
    ];
    const ranked = rankOffers(offers, { preferredSupplierId: "ramedicas", preferredSupplierTolerance: 0.02 });
    expect(ranked[0].supplierId).toBe("ramedicas");
  });

  it("el proveedor preferido NO gana si supera el margen de tolerancia", () => {
    const offers = [
      offer({ supplierId: "ramedicas", totalCost: 12000 }),
      offer({ supplierId: "disfarma", totalCost: 9900 }),
    ];
    const ranked = rankOffers(offers, { preferredSupplierId: "ramedicas", preferredSupplierTolerance: 0.02 });
    expect(ranked[0].supplierId).toBe("disfarma");
  });

  it("ordena por costo total, no por precio unitario, cuando las presentaciones difieren", () => {
    // Mismo medicamento: Ramedicas en caja x30 mas cara por unidad pero el
    // cliente solo necesita 30, asi que su costo total es menor que comprar 2
    // cajas x100 de Disfarma para cubrir lo mismo.
    const offers = [
      offer({ supplierId: "disfarma", packageSize: 100, unitPrice: 90, packagesNeeded: 1, totalCost: 9000 }),
      offer({ supplierId: "ramedicas", packageSize: 30, unitPrice: 95, packagesNeeded: 1, totalCost: 2850 }),
    ];
    const ranked = rankOffers(offers, { preferredSupplierId: null, preferredSupplierTolerance: 0.02 });
    expect(ranked[0].supplierId).toBe("ramedicas");
  });
});
