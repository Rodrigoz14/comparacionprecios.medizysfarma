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
    unitPrice: 100,
    availability: "AVAILABLE",
    stockQuantity: null,
    eligible: true,
    discardReason: null,
    ...overrides,
  };
}

describe("rankOffers", () => {
  it("ordena por menor precio cuando no hay proveedor preferido", () => {
    const offers = [
      offer({ supplierId: "a", unitPrice: 200 }),
      offer({ supplierId: "b", unitPrice: 100 }),
      offer({ supplierId: "c", unitPrice: 150 }),
    ];
    const ranked = rankOffers(offers, { preferredSupplierId: null, preferredSupplierTolerance: 0.02 });
    expect(ranked.map((o) => o.supplierId)).toEqual(["b", "c", "a"]);
  });

  it("el proveedor preferido gana si esta dentro del margen de tolerancia", () => {
    const offers = [
      offer({ supplierId: "ramedicas", unitPrice: 10000 }),
      offer({ supplierId: "disfarma", unitPrice: 9900 }),
    ];
    const ranked = rankOffers(offers, { preferredSupplierId: "ramedicas", preferredSupplierTolerance: 0.02 });
    expect(ranked[0].supplierId).toBe("ramedicas");
  });

  it("el proveedor preferido NO gana si supera el margen de tolerancia", () => {
    const offers = [
      offer({ supplierId: "ramedicas", unitPrice: 12000 }),
      offer({ supplierId: "disfarma", unitPrice: 9900 }),
    ];
    const ranked = rankOffers(offers, { preferredSupplierId: "ramedicas", preferredSupplierTolerance: 0.02 });
    expect(ranked[0].supplierId).toBe("disfarma");
  });
});
