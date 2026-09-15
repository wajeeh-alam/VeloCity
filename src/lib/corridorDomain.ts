import type {
  CorridorScore,
  CorridorTier,
  ScoreInputs,
  ScoreKey,
} from './corridorScoring.ts'

export type { CorridorTier, ScoreInputs, ScoreKey }

export type CandidateProvenance =
  | {
      kind: 'plan-backed'
      sourceName: string
      sourceUrl: string
      sourceRecordId?: string
    }
  | {
      kind: 'exploratory'
      sourceName: string
      sourceUrl?: string
    }
  | {
      kind: 'synthetic-fixture'
      sourceName: 'VeloCity deterministic fallback'
    }

export type ObservedDemandProvenance =
  | {
      kind: 'bike-share-od'
      sourceName: string
      sourceUrl: string
      observationStart: string
      observationEnd: string
      tripCount?: number
    }
  | {
      kind: 'counter-observation'
      sourceName: string
      sourceUrl: string
      observationStart: string
      observationEnd: string
      observedHours?: number
    }
  | {
      kind: 'multiple-observed-sources'
      sourceName: string
      sourceUrls: string[]
      observationStart: string
      observationEnd: string
    }
  | {
      kind: 'synthetic-fixture'
      sourceName: 'VeloCity deterministic fallback'
    }

/** Candidate origin and observed-demand origin stay separate by design. */
export type CorridorProvenance = {
  candidate: CandidateProvenance
  observedDemand: ObservedDemandProvenance
}

export type Corridor = {
  id: string
  name: string
  subtitle: string
  tier: CorridorTier
  meanScore: number
  inputs: ScoreInputs
  path: string
  color: string
  rolloutYear: number
  /** Original portfolio delivery year, retained when the UI changes horizon. */
  plannedRolloutYear?: 1 | 2 | 3
  summary: string
  provenance?: CorridorProvenance
}

/**
 * Public metric keys are retained for the existing UI. Units and direction
 * are explicit here so artifact producers cannot silently change meaning.
 */
export type SimulationMetrics = {
  /** Weighted representative trips per typical weekday. */
  lowStressTrips: number
  /** Residents gaining access to the connected low-stress network. */
  populationConnected: number
  /** Unique destination clusters reachable within the analysis threshold. */
  destinationsReached: number
  /** Corridor segments classified as high-stress. Lower is better. */
  dangerousSegments: number
}

export type SimulationMetricKey = keyof SimulationMetrics

export type SimulationMetricDefinition = {
  label: string
  unit: 'weighted-trips-per-weekday' | 'people' | 'destination-clusters' | 'segments'
  betterDirection: 'higher' | 'lower'
  integer: true
}

export const SIMULATION_METRIC_DEFINITIONS: Readonly<
  Record<SimulationMetricKey, SimulationMetricDefinition>
> = {
  lowStressTrips: {
    label: 'Simulated low-stress uptake',
    unit: 'weighted-trips-per-weekday',
    betterDirection: 'higher',
    integer: true,
  },
  populationConnected: {
    label: 'Population connected',
    unit: 'people',
    betterDirection: 'higher',
    integer: true,
  },
  destinationsReached: {
    label: 'Destination clusters reached',
    unit: 'destination-clusters',
    betterDirection: 'higher',
    integer: true,
  },
  dangerousSegments: {
    label: 'High-stress segments',
    unit: 'segments',
    betterDirection: 'lower',
    integer: true,
  },
}

export type SimulatedAgent = {
  id: string
  delay: number
  /** Valid SVG motion path representing the built/rerouted route. */
  path: string
  /** Number of estimated trips represented by this display agent. */
  weight?: number
  weightUnit?: 'weighted-trips-per-weekday'
  beforePath?: string
  afterPath?: string
  semantics?: 'representative-rerouted-demand'
}

export type SimulationMode = 'trained-artifact' | 'synthetic-fallback'

export type CorridorSimulation = {
  before: SimulationMetrics
  after: SimulationMetrics
  agents: SimulatedAgent[]
  scoring?: CorridorScore
  mode?: SimulationMode
  disclaimer?: string
  artifactId?: string
  warnings?: string[]
}

export type PortfolioNetworkState = {
  /** Scenario horizon, not the corridor's planned construction year. */
  horizonYear: 1 | 2 | 3
  activeCorridorIds: string[]
}

export const SYNTHETIC_SIMULATION_DISCLAIMER =
  'Synthetic deterministic fallback: exact values are illustrative weighted demand and accessibility indicators, not observed counts, trained-model predictions, causal effects, or official recommendations.'
