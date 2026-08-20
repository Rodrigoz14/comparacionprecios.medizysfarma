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
}

export interface MatchResult {
  decision: MatchDecision;
  confidence: number;
  matchedProductIds: string[];
  candidates: ScoredCandidate[];
  reasons: string[];
  source: "deterministic" | "ai" | "none";
}
