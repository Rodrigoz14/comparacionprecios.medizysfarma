export interface ExtractedAttributes {
  activeIngredient: string;
  concentration: string;
  concentrationUnit: string;
  dosageForm: string;
  presentationType: string;
  presentationQuantity: number;
  presentationUnit: string;
}

export type MatchDecision = "MATCH" | "REVIEW" | "NO_MATCH";

export interface CandidateProduct {
  id: string;
  standardName: string;
  normalizedName: string;
  genericKey: string;
  activeIngredient: string;
  concentration: string;
  concentrationUnit: string;
  dosageForm: string;
  presentationType: string;
  presentationQuantity: number;
  presentationUnit: string;
  laboratoryId: string | null;
}

export interface AttributeComparison {
  activeIngredientMatch: boolean;
  concentrationMatch: boolean;
  dosageFormMatch: boolean;
  presentationMatch: boolean;
}

export interface ScoredCandidate {
  product: CandidateProduct;
  comparison: AttributeComparison;
  score: number;
  /** true si se encontró por un sinónimo controlado (p. ej. paracetamol/acetaminofén), no por el mismo texto. */
  viaSynonym: boolean;
  /** true si se encontró tolerando un posible error de tipeo/OCR (p. ej. "valprico" por "valproico"), no por texto exacto ni sinónimo controlado. */
  viaFuzzyMatch: boolean;
  /** true si se encontró porque todas las palabras buscadas están contenidas en un principio activo con palabras adicionales (p. ej. buscar "Hidroxido de aluminio + Simeticona" encuentra "Aluminio Hidroxido + Magnesio Hidroxido + Simeticona"), no por texto exacto ni sinónimo controlado. */
  viaSubsetMatch: boolean;
  /** true si se encontró por el nombre comercial (marca) entre paréntesis en el nombre del proveedor, no por principio activo. */
  viaBrandMatch: boolean;
}

export interface MatchResult {
  decision: MatchDecision;
  confidence: number;
  matchedProductIds: string[];
  candidates: ScoredCandidate[];
  reasons: string[];
  source: "deterministic" | "ai" | "manual" | "none";
}
