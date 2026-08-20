import type { MatchDecision } from "@/lib/matching/types";

export const AUTO_MATCH_THRESHOLD = 0.95;
export const REVIEW_THRESHOLD = 0.8;

/**
 * Regla determinística final: una concentración distinta nunca puede resultar en
 * MATCH, sin importar qué tan alto sea el puntaje o qué diga la IA (Sección 5.35).
 */
export function decideFromScore(score: number, concentrationMatch: boolean): MatchDecision {
  if (!concentrationMatch) return score >= REVIEW_THRESHOLD ? "REVIEW" : "NO_MATCH";
  if (score >= AUTO_MATCH_THRESHOLD) return "MATCH";
  if (score >= REVIEW_THRESHOLD) return "REVIEW";
  return "NO_MATCH";
}
