/**
 * Deterministic weighted scoring for markets, categories and products.
 *
 * Every factor is rated 0-10 by the researching agent. The server does the
 * arithmetic so the same inputs always produce the same score, and so a score
 * can never drift because a model "felt" differently about a product later.
 */

import { CATEGORY_WEIGHTS, MARKET_CRITERIA, PRODUCT_WEIGHTS } from "./constants.js";
import { round } from "./format.js";

export interface ScoreBreakdown {
  factor: string;
  rating: number;
  weight: number;
  points: number;
  max_points: number;
}

export interface ScoreResult {
  score: number;
  max_score: number;
  breakdown: ScoreBreakdown[];
  missing_factors: string[];
  /** Weight that could not be awarded because a factor was not rated. */
  unrated_weight: number;
}

function weightedScore(weights: Record<string, number>, ratings: Record<string, number>): ScoreResult {
  const breakdown: ScoreBreakdown[] = [];
  const missing: string[] = [];
  let score = 0;
  let unratedWeight = 0;

  for (const [factor, weight] of Object.entries(weights)) {
    const rating = ratings[factor];
    if (rating === undefined || rating === null || Number.isNaN(rating)) {
      missing.push(factor);
      unratedWeight += weight;
      continue;
    }
    const points = (rating / 10) * weight;
    score += points;
    breakdown.push({
      factor,
      rating,
      weight,
      points: round(points, 2),
      max_points: weight,
    });
  }

  return {
    score: round(score, 1),
    max_score: 100,
    breakdown,
    missing_factors: missing,
    unrated_weight: unratedWeight,
  };
}

export function scoreCategory(ratings: Record<string, number>): ScoreResult {
  return weightedScore(CATEGORY_WEIGHTS, ratings);
}

export function scoreProduct(ratings: Record<string, number>): ScoreResult {
  return weightedScore(PRODUCT_WEIGHTS, ratings);
}

/**
 * Markets use 12 equally weighted criteria rated 0-10, normalised to 100.
 * Criteria are phrased so that higher is always more favourable (e.g.
 * `low_customs_and_import_friction`: 10 means almost no friction).
 */
export function scoreMarket(ratings: Record<string, number>): ScoreResult {
  const weight = 100 / MARKET_CRITERIA.length;
  const weights: Record<string, number> = {};
  for (const criterion of MARKET_CRITERIA) weights[criterion] = weight;
  return weightedScore(weights, ratings);
}

export function unknownFactors(weights: Record<string, number>, ratings: Record<string, number>): string[] {
  return Object.keys(ratings).filter((key) => !(key in weights));
}
