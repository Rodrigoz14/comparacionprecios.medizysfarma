import type { Availability } from "@/lib/generated/prisma/client";

export type SelectionStatus = "SELECTED" | "REVIEW" | "NOT_FOUND" | "NO_STOCK" | "NO_VALID_OFFER";

export interface OfferOption {
  supplierOfferId: string;
  supplierId: string;
  supplierName: string;
  productId: string;
  laboratoryName: string | null;
  unitPrice: number;
  availability: Availability;
  stockQuantity: number | null;
  eligible: boolean;
  discardReason: string | null;
}

export interface PricingRules {
  /** Si un proveedor preferido está a menos de esta tolerancia del más barato, gana él. Desactivado si es null. */
  preferredSupplierId: string | null;
  preferredSupplierTolerance: number;
}

export interface SelectionResult {
  customerRequestItemId: string;
  requestedQuantity: number;
  status: SelectionStatus;
  selected: OfferOption | null;
  alternatives: OfferOption[];
  unitPrice: number | null;
  totalPrice: number | null;
  savings: number | null;
  reason: string;
}
