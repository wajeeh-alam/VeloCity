import type {
  Corridor,
  CorridorProvenance,
  ScoreInputs,
} from '../lib/corridorDomain.ts'
export { DEMAND_ARTIFACT_SCHEMA_VERSION, DEMAND_TARGET, canonicalFeatureSnapshot, hashFeatureSnapshot, parseCorridorDemandArtifact } from '../lib/corridorDemandArtifact.ts'
export type { CorridorDemandArtifact, DemandPrediction, DemandFeatureSnapshot } from '../lib/corridorDemandArtifact.ts'
export type { SimulationNetwork, NetworkNode, NetworkEdge, DemandFlow, ScenarioRoute, RouteResult } from '../lib/corridorNetworkSimulation.ts'
export { validateSimulationNetwork } from '../lib/corridorNetworkSimulation.ts'
export { generatePortfolioRollout } from '../lib/corridorPortfolio.ts'
export type { PortfolioCandidate, PortfolioRollout } from '../lib/corridorPortfolio.ts'
import {
  evaluateScore,
  normalizeScoreInputs,
} from '../lib/corridorScoring.ts'

export type {
  CandidateProvenance,
  Corridor,
  CorridorProvenance,
  CorridorSimulation,
  ObservedDemandProvenance,
  PortfolioNetworkState,
  SimulatedAgent,
  SimulationMetricDefinition,
  SimulationMetricKey,
  SimulationMetrics,
} from '../lib/corridorDomain.ts'
export type {
  ArtifactParseResult,
  CorridorPredictionArtifact,
  CorridorPredictionRecord,
  PredictionArtifactModel,
  SpatialValidation,
} from '../lib/corridorArtifact.ts'
export type { SimulationOptions } from '../lib/corridorSimulation.ts'
export type {
  CorridorScore,
  CorridorTier,
  ScoreInputs,
  ScoreKey,
} from '../lib/corridorScoring.ts'

export {
  PREDICTION_ARTIFACT_SCHEMA_VERSION,
  parseCorridorPredictionArtifact,
  scoreInputsMatch,
} from '../lib/corridorArtifact.ts'
export {
  SIMULATION_METRIC_DEFINITIONS,
  SYNTHETIC_SIMULATION_DISCLAIMER,
} from '../lib/corridorDomain.ts'
export {
  createArtifactAwareSimulator,
  isValidSvgMotionPath,
  simulateCorridor,
} from '../lib/corridorSimulation.ts'
export {
  CORE_SCORE_KEYS,
  CORE_WEAKNESS_THRESHOLD,
  SCORE_INPUT_SEMANTICS,
  SCORE_KEYS,
  SCORE_WEIGHTS,
  SCORING_RUBRIC_VERSION,
  STRONG_SCORE_THRESHOLD,
  calculateWeightedScore,
  clampScore,
  countStrongInputs,
  determineTier,
  evaluateScore,
  normalizeScoreInputs,
} from '../lib/corridorScoring.ts'

type CorridorFixture = Omit<Corridor, 'tier' | 'meanScore' | 'inputs'> & {
  inputs: ScoreInputs
}

const SYNTHETIC_PROVENANCE: CorridorProvenance = {
  candidate: {
    kind: 'synthetic-fixture',
    sourceName: 'VeloCity deterministic fallback',
  },
  observedDemand: {
    kind: 'synthetic-fixture',
    sourceName: 'VeloCity deterministic fallback',
  },
}

/**
 * Source registry for the production artifact contract. The fallback values
 * below are not derived from these sources. Member A artifacts must record
 * candidate provenance separately from observed OD/counter-demand provenance.
 */
export const CORRIDOR_SOURCE_REGISTRY = {
  transportationData: {
    name: 'City of Toronto Transportation Data & Analytics',
    url: 'https://www.toronto.ca/services-payments/streets-parking-transportation/road-safety/big-data-innovation-team/',
    role: 'observed-volume, collision, and transportation data catalogue',
  },
  bikeShareOd: {
    name: 'Mapping Bike Share Trips in Toronto',
    url: 'https://open.toronto.ca/gallery-item/mapping-bike-share-trips-in-toronto/',
    role: 'observed origin-destination demand; not candidate-route authority',
  },
  cyclingNetworkPlan: {
    name: 'City of Toronto Cycling Network Plan',
    url: 'https://www.toronto.ca/services-payments/streets-parking-transportation/cycling-in-toronto/cycling-infrastructure-definitions/cycling-network-plan/',
    role: 'plan-backed candidate and prioritization provenance',
  },
} as const

/** Prominent runtime provenance for the currently exported catalogue. */
export const CORRIDOR_DATA_METADATA = {
  version: 'synthetic-fallback-v2',
  generatedAt: null,
  isIllustrative: true,
  mode: 'synthetic-fallback',
  scoringMode: 'transparent-weighted-priority-rubric',
  modelStatus: 'no-production-artifact-loaded',
  units:
    'weighted trips per typical weekday, people, destination clusters, and high-stress segments',
  disclaimer:
    'Synthetic deterministic fixtures only; values are not source-derived observations, trained-model predictions, causal forecasts, or official recommendations.',
} as const

/** Canonical derivation for initial data and every UI-edited corridor. */
export function evaluateCorridor(corridor: Corridor): Corridor {
  const inputs = normalizeScoreInputs(corridor.inputs)
  const score = evaluateScore(inputs)
  return {
    ...corridor,
    inputs,
    meanScore: score.meanScore,
    tier: score.tier,
  }
}

/** Convenience helper for UI state: applies edits and refreshes derived data. */
export function withCorridorInputs(
  corridor: Corridor,
  inputs: unknown,
  rolloutYear = corridor.rolloutYear,
): Corridor {
  return evaluateCorridor({
    ...corridor,
    inputs: normalizeScoreInputs(inputs),
    rolloutYear,
  })
}

function createCorridor(fixture: CorridorFixture): Corridor {
  const plannedRolloutYear = [1, 2, 3].includes(fixture.rolloutYear)
    ? (fixture.rolloutYear as 1 | 2 | 3)
    : 1
  return evaluateCorridor({
    ...fixture,
    inputs: fixture.inputs,
    tier: 'Low',
    meanScore: 0,
    plannedRolloutYear,
    provenance: fixture.provenance ?? SYNTHETIC_PROVENANCE,
  })
}

/** Six deterministic UI fixtures, explicitly not a production candidate set. */
export const corridors: Corridor[] = [
  createCorridor({
    id: 'eglinton-east',
    name: 'Eglinton East Connector',
    subtitle: 'Kennedy Station to Kingston Road',
    color: '#17A673',
    rolloutYear: 1,
    path: 'M92 238 C154 226 216 211 283 194 C342 179 401 170 462 155',
    summary:
      'Synthetic east-end scenario connecting transit, neighbourhood destinations, and a low-stress network gap.',
    inputs: {
      safety: 84,
      connectivity: 82,
      equity: 91,
      currentDemand: 63,
      potentialDemand: 88,
      transit: 86,
      barriers: 67,
      coverage: 78,
      destinations: 81,
    },
  }),
  createCorridor({
    id: 'jane-north',
    name: 'Jane North Spine',
    subtitle: 'Finch West to Wilson Avenue',
    color: '#5B7CFA',
    rolloutYear: 1,
    path: 'M155 55 C160 104 168 152 176 200 C183 243 189 286 199 331',
    summary:
      'Synthetic north–south scenario focused on crossings, transit access, and network coverage.',
    inputs: {
      safety: 89,
      connectivity: 74,
      equity: 88,
      currentDemand: 49,
      potentialDemand: 83,
      transit: 79,
      barriers: 71,
      coverage: 85,
      destinations: 66,
    },
  }),
  createCorridor({
    id: 'dufferin-gap',
    name: 'Dufferin Gap',
    subtitle: 'St. Clair West to the Waterfront',
    color: '#E68A2E',
    rolloutYear: 2,
    path: 'M244 83 C239 130 247 174 242 219 C238 263 247 306 251 353',
    summary:
      'Synthetic central scenario testing continuity between fragmented east–west facilities.',
    inputs: {
      safety: 81,
      connectivity: 87,
      equity: 58,
      currentDemand: 77,
      potentialDemand: 79,
      transit: 72,
      barriers: 54,
      coverage: 64,
      destinations: 84,
    },
  }),
  createCorridor({
    id: 'don-mills-south',
    name: 'Don Mills South Link',
    subtitle: 'Flemingdon Park to Danforth Avenue',
    color: '#9A6AE8',
    rolloutYear: 2,
    path: 'M355 91 C344 130 350 164 367 198 C386 235 382 273 370 315',
    summary:
      'Synthetic valley-crossing scenario emphasizing continuity, access, and barrier reduction.',
    inputs: {
      safety: 75,
      connectivity: 69,
      equity: 86,
      currentDemand: 46,
      potentialDemand: 76,
      transit: 68,
      barriers: 83,
      coverage: 73,
      destinations: 59,
    },
  }),
  createCorridor({
    id: 'lawrence-east',
    name: 'Lawrence East Crosstown',
    subtitle: 'Victoria Park to Morningside',
    color: '#D95C72',
    rolloutYear: 3,
    path: 'M334 126 C381 119 423 126 465 121 C510 116 550 126 598 119',
    summary:
      'Synthetic suburban scenario exploring latent demand near transit, schools, and daily destinations.',
    inputs: {
      safety: 71,
      connectivity: 57,
      equity: 82,
      currentDemand: 38,
      potentialDemand: 73,
      transit: 75,
      barriers: 58,
      coverage: 79,
      destinations: 56,
    },
  }),
  createCorridor({
    id: 'kipling-south',
    name: 'Kipling South Connector',
    subtitle: 'Bloor Street West to Lake Shore',
    color: '#3F9AB2',
    rolloutYear: 3,
    path: 'M92 174 C105 207 104 242 112 274 C120 307 110 337 124 369',
    summary:
      'Synthetic western scenario probing access to employment, transit, and the waterfront network.',
    inputs: {
      safety: 66,
      connectivity: 62,
      equity: 54,
      currentDemand: 43,
      potentialDemand: 65,
      transit: 58,
      barriers: 57,
      coverage: 49,
      destinations: 56,
    },
  }),
]
