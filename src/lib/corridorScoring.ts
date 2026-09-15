/** The nine versioned inputs used by the VeloCity scoring rubric. */
export const SCORE_KEYS = [
  'safety',
  'connectivity',
  'equity',
  'currentDemand',
  'potentialDemand',
  'transit',
  'barriers',
  'coverage',
  'destinations',
] as const

export type ScoreKey = (typeof SCORE_KEYS)[number]
export type ScoreInputs = Record<ScoreKey, number>
export type CorridorTier = 'Top' | 'High' | 'Medium' | 'Low'

/**
 * Every input is a positive priority signal: a larger value means that a
 * corridor is a stronger candidate for investment. In particular, `safety`
 * means safety need, `barriers` means value from overcoming a barrier, and
 * `coverage` means size of the current network gap.
 */
export const SCORE_INPUT_SEMANTICS: Readonly<
  Record<ScoreKey, { label: string; highValueMeans: string }>
> = {
  safety: { label: 'Safety need', highValueMeans: 'greater existing safety need' },
  connectivity: { label: 'Connectivity value', highValueMeans: 'greater network-connection value' },
  equity: { label: 'Equity priority', highValueMeans: 'greater equity priority' },
  currentDemand: { label: 'Observed demand', highValueMeans: 'more observed cycling demand' },
  potentialDemand: { label: 'Potential demand', highValueMeans: 'more trips with mode-shift potential' },
  transit: { label: 'Transit integration', highValueMeans: 'greater multimodal access value' },
  barriers: { label: 'Barrier-crossing value', highValueMeans: 'greater value from overcoming a barrier' },
  coverage: { label: 'Network coverage gap', highValueMeans: 'larger gap in the protected network' },
  destinations: { label: 'Destinations served', highValueMeans: 'more useful destinations served' },
}

/**
 * Transparent planning weights. They sum to exactly one. These are versioned
 * assumptions, not learned model coefficients.
 */
export const SCORE_WEIGHTS: Readonly<Record<ScoreKey, number>> = {
  safety: 0.15,
  connectivity: 0.15,
  equity: 0.1,
  currentDemand: 0.1,
  potentialDemand: 0.15,
  transit: 0.08,
  barriers: 0.1,
  coverage: 0.08,
  destinations: 0.09,
}

export const SCORING_RUBRIC_VERSION = 'velocity-priority-v1'
export const STRONG_SCORE_THRESHOLD = 60
export const CORE_WEAKNESS_THRESHOLD = 40

export const CORE_SCORE_KEYS = [
  'safety',
  'connectivity',
  'potentialDemand',
] as const satisfies readonly ScoreKey[]

export type CorridorScore = {
  meanScore: number
  tier: CorridorTier
  strongInputCount: number
  coreWeaknesses: Array<(typeof CORE_SCORE_KEYS)[number]>
  rubricVersion: typeof SCORING_RUBRIC_VERSION
}

/** Coerces unknown, non-finite, or out-of-range values onto the 0–100 scale. */
export function clampScore(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.min(100, Math.max(0, numeric))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Returns a complete safe copy instead of trusting data at runtime. */
export function normalizeScoreInputs(inputs: unknown): ScoreInputs {
  const source = isRecord(inputs) ? inputs : {}
  return Object.fromEntries(
    SCORE_KEYS.map((key) => [key, clampScore(source[key])]),
  ) as ScoreInputs
}

/** Computes a normalized weighted priority score on a 0–100 scale. */
export function calculateWeightedScore(inputs: unknown): number {
  const normalized = normalizeScoreInputs(inputs)
  const score = SCORE_KEYS.reduce(
    (total, key) => total + normalized[key] * SCORE_WEIGHTS[key],
    0,
  )
  return Math.round(score * 10) / 10
}

export function countStrongInputs(inputs: unknown): number {
  const normalized = normalizeScoreInputs(inputs)
  return SCORE_KEYS.filter(
    (key) => normalized[key] >= STRONG_SCORE_THRESHOLD,
  ).length
}

/**
 * Applies the published discrete tier gates. A corridor with 8–9 strong
 * inputs but any core score below 40 is explicitly capped at High. The
 * weighted score ranks corridors within a tier and never promotes one across
 * a gate, so it is valid for no corridor to qualify as Top.
 */
export function determineTier(inputs: unknown): CorridorTier {
  const normalized = normalizeScoreInputs(inputs)
  const strongCount = countStrongInputs(normalized)
  const hasCoreWeakness = CORE_SCORE_KEYS.some(
    (key) => normalized[key] < CORE_WEAKNESS_THRESHOLD,
  )

  if (strongCount >= 8) return hasCoreWeakness ? 'High' : 'Top'
  if (strongCount >= 6) return 'High'
  if (strongCount >= 4) return 'Medium'
  return 'Low'
}

/** Canonical derivation used after every edit; never trust cached UI values. */
export function evaluateScore(inputs: unknown): CorridorScore {
  const normalized = normalizeScoreInputs(inputs)
  return {
    meanScore: calculateWeightedScore(normalized),
    tier: determineTier(normalized),
    strongInputCount: countStrongInputs(normalized),
    coreWeaknesses: CORE_SCORE_KEYS.filter(
      (key) => normalized[key] < CORE_WEAKNESS_THRESHOLD,
    ),
    rubricVersion: SCORING_RUBRIC_VERSION,
  }
}
