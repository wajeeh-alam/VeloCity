import type { ScoreInputs } from '../lib/corridorScoring.ts'
import type { SimulationMetrics } from '../lib/corridorDomain.ts'
import { parseCorridorDemandArtifact } from '../lib/corridorDemandArtifact.ts'

export type GeoLine = {
  type: 'LineString' | 'MultiLineString'
  coordinates: unknown[]
}

export type SimulationMetricDeltas = Record<keyof SimulationMetrics, number>

export type OpportunityProfile = {
  corridorId: string
  name: string
  subtitle: string
  sourceStatus: string
  geometry: GeoLine
  evidence: {
    status: 'trained-artifact'
    inputScores: ScoreInputs
    rawFeatures: Record<string, number | null>
    prediction: {
      relativeBicyclesPerObservedHour: number
      uncertainty: {
        lower: number
        upper: number
        level: number
        method: string
      }
    }
    observation: { start: string; end: string }
    sourceProvenance: string[]
    modelBeatBaseline: boolean
    modelValidation: {
      metric: 'mae' | 'rmse'
      modelValue: number
      medianBaselineValue: number
    }
  }
  priority: {
    score: number
    tier: 'Top' | 'High' | 'Medium' | 'Low'
    strongInputCount: number
    rank: number
    rolloutYear: 1 | 2 | 3
  }
  comparison: {
    status: 'synthetic-fallback'
    before: SimulationMetrics
    after: SimulationMetrics
    deltas: SimulationMetricDeltas
    routeAlternatives: Array<{
      id: string
      kind: 'existing-condition' | 'official-candidate-alignment'
      label: string
      geometryRef: 'record.geometry' | null
      geometrySource: 'none' | 'cycling-program-2025-2027'
    }>
    selectedRouteId: string
    representativeAgents: Array<{
      id: string
      weight: number
      weightUnit: 'simulated-low-stress-trips-per-weekday'
      origin: [number, number]
      destination: [number, number]
      beforeRouteId: null
      afterRouteId: string
    }>
    networkState: {
      horizonYear: 1 | 2 | 3
      beforeActiveCorridorIds: string[]
      afterActiveCorridorIds: string[]
    }
    warnings: string[]
  }
}

export type OpportunityArtifact = {
  schemaVersion: 'velocity.corridor-opportunities.v1'
  artifactId: string
  generatedAt: string
  evidenceArtifactId: string
  scenarioModel: {
    id: string
    version: string
    nature: 'synthetic-fallback'
    generatedFrom: 'velocity.corridor-demand.v2'
    metricDefinitions: Record<
      keyof SimulationMetrics,
      { unit: string; betterDirection: 'higher' | 'lower' }
    >
    assumptions: string[]
  }
  portfolio: {
    strategy: 'illustrative-evidence-priority-order'
    disclaimer: string
    years: Array<{ year: 1 | 2 | 3; corridorIds: string[] }>
  }
  records: OpportunityProfile[]
}

export function parseOpportunityArtifact(value: unknown): OpportunityArtifact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Opportunity artifact must be an object')
  }
  const artifact = value as Partial<OpportunityArtifact>
  if (artifact.schemaVersion !== 'velocity.corridor-opportunities.v1') {
    throw new Error('Unsupported opportunity artifact schema')
  }
  if (!artifact.artifactId || !artifact.evidenceArtifactId || !Array.isArray(artifact.records)) {
    throw new Error('Opportunity artifact is missing required fields')
  }
  const ids = new Set<string>()
  for (const record of artifact.records) {
    if (
      !record?.corridorId ||
      ids.has(record.corridorId) ||
      record.evidence?.status !== 'trained-artifact' ||
      record.comparison?.status !== 'synthetic-fallback'
    ) {
      throw new Error(`Invalid opportunity record: ${record?.corridorId ?? 'unknown'}`)
    }
    ids.add(record.corridorId)
  }
  return artifact as OpportunityArtifact
}

/** GitHub Pages-safe loader for Member C's dashboard. */
export async function loadOpportunityArtifact(
  fetcher: typeof fetch = fetch,
): Promise<OpportunityArtifact> {
  const response = await fetcher(`${import.meta.env.BASE_URL}data/corridor-opportunities.json`)
  if (!response.ok) throw new Error(`Opportunity data failed to load (${response.status})`)
  return parseOpportunityArtifact(await response.json())
}

/** Loads the training-only hourly reference used to convert relative demand into an approximate hourly count. */
export async function loadDemandReferenceBicyclesPerHour(
  fetcher: typeof fetch = fetch,
): Promise<number> {
  const response = await fetcher(`${import.meta.env.BASE_URL}data/corridor-demand.json`)
  if (!response.ok) throw new Error(`Demand data failed to load (${response.status})`)
  const parsed = parseCorridorDemandArtifact(await response.json())
  if (!parsed.ok) throw new Error(`Demand data is invalid: ${parsed.errors[0]}`)
  return parsed.artifact.model.normalization.referenceBicyclesPerHour
}
