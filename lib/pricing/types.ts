import type { Availability } from "@/lib/generated/prisma/client";

export type SelectionStatus = "SELECTED" | "REVIEW" | "NOT_FOUND" | "NO_STOCK" | "NO_VALID_OFFER" | "COVERED_BY_STOCK";

export interface OfferOption {
  supplierOfferId: string;
  supplierId: string;
  supplierName: string;
  productId: string;
  laboratoryName: string | null;
  /** Tamaño del empaque de esta oferta (p. ej. 30 en "caja x30"). */
  packageSize: number;
  presentationUnit: string;
  /** Precio de UN empaque completo, tal como lo vende el proveedor. */
  packagePrice: number;
  /** packagePrice / packageSize: referencia para comparar presentaciones, pero no es el criterio de selección. */
  unitPrice: number;
  /** Empaques completos necesarios para esta oferta específica, dado lo pedido (no se compran unidades sueltas). */
  packagesNeeded: number;
  /** packagesNeeded * packagePrice: lo que realmente cuesta cubrir el pedido con esta oferta. Es el criterio de selección. */
  totalCost: number;
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
  /** Existencia en bodega del genérico homologado. Null si el ítem aún no tiene producto homologado. */
  warehouseStock: number | null;
  /** = max(0, requestedQuantity - warehouseStock). Lo que realmente se cotiza. Null si aún no se calculó. */
  quantityToPurchase: number | null;
  status: SelectionStatus;
  selected: OfferOption | null;
  alternatives: OfferOption[];
  /** = selected.totalCost, repetido aquí para no obligar a leer un campo anidado. */
  totalPrice: number | null;
  /** Ahorro frente a la oferta elegible más cara, cada una con su propio empaquetado. */
  savings: number | null;
  reason: string;
}
