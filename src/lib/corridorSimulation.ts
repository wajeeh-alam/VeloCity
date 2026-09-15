import {
  parseCorridorPredictionArtifact,
  scoreInputsMatch,
  type CorridorPredictionArtifact,
  type CorridorPredictionRecord,
} from './corridorArtifact.ts'
import {
  SYNTHETIC_SIMULATION_DISCLAIMER,
  type Corridor,
  type CorridorSimulation,
  type PortfolioNetworkState,
  type SimulatedAgent,
  type SimulationMetrics,
} from './corridorDomain.ts'
import { evaluateScore, normalizeScoreInputs } from './corridorScoring.ts'
import { DEMAND_ARTIFACT_SCHEMA_VERSION, parseCorridorDemandArtifact } from './corridorDemandArtifact.ts'
import { simulateDemandNetwork, validateSimulationNetwork, type SimulationNetwork } from './corridorNetworkSimulation.ts'

export type SimulationOptions = {
  /** Prefer the demand-only v2 contract. v1 is retained for legacy callers. */
  artifact?: unknown
  demandArtifact?: unknown
  network?: SimulationNetwork
  networkState?: PortfolioNetworkState
}

const SVG_PATH_COMMAND_ARITY: Readonly<Record<string, number>> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
}

const SVG_PATH_TOKEN = /[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi

/** Conservative SVG path validator suitable for untrusted static artifacts. */
export function isValidSvgMotionPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 20_000) {
    return false
  }
  const tokens = value.match(SVG_PATH_TOKEN)
  if (!tokens || tokens.length < 4) return false
  const remainder = value.replace(SVG_PATH_TOKEN, '').replace(/[\s,]/g, '')
  if (remainder.length > 0) return false

  let index = 0
  let firstCommand = true
  let hasDrawingCommand = false
  while (index < tokens.length) {
    const rawCommand = tokens[index]
    if (!/^[a-zA-Z]$/.test(rawCommand)) return false
    const command = rawCommand.toUpperCase()
    const arity = SVG_PATH_COMMAND_ARITY[command]
    if (arity === undefined) return false
    if (firstCommand && command !== 'M') return false
    firstCommand = false
    index += 1

    const parameters: number[] = []
    while (index < tokens.length && !/^[a-zA-Z]$/.test(tokens[index])) {
      const number = Number(tokens[index])
      if (!Number.isFinite(number)) return false
      parameters.push(number)
      index += 1
    }
    const parameterCount = parameters.length
    if (arity === 0) {
      if (parameterCount !== 0) return false
    } else if (parameterCount < arity || parameterCount % arity !== 0) {
      return false
    }
    if (command === 'A') {
      for (let offset = 0; offset < parameters.length; offset += arity) {
        if (parameters[offset] < 0 || parameters[offset + 1] < 0) return false
        if (![0, 1].includes(parameters[offset + 3])) return false
        if (![0, 1].includes(parameters[offset + 4])) return false
      }
    }
    if (command !== 'M' && command !== 'Z') hasDrawingCommand = true
    if (command === 'M' && parameterCount > 2) hasDrawingCommand = true
  }
  return hasDrawingCommand
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seededRandom(seed: number): () => number {
  let state = seed || 1
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function roundTo(value: number, places = 0): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function boundedInteger(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(Math.min(maximum, Math.max(0, value)))
}

function normalizedHorizon(value: number): 1 | 2 | 3 {
  if (!Number.isFinite(value)) return 1
  if (value >= 3) return 3
  if (value >= 2) return 2
  return 1
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const expected = new Set(left)
  const actual = new Set(right)
  if (expected.size !== left.length || actual.size !== right.length) return false
  if (expected.size !== actual.size) return false
  return [...actual].every((item) => expected.has(item))
}

function findUsablePrediction(
  corridor: Corridor,
  options: SimulationOptions,
): {
  artifact?: CorridorPredictionArtifact
  record?: CorridorPredictionRecord
  warning?: string
} {
  if (!options.artifact) return {}
  const parsed = parseCorridorPredictionArtifact(options.artifact)
  if (!parsed.ok) {
    return {
      warning: `Prediction artifact failed runtime validation: ${parsed.errors[0] ?? 'unknown schema error'}`,
    }
  }
  const artifact = parsed.artifact
  if (!artifact.model.productionEligible) {
    return { warning: 'Prediction artifact failed its spatial baseline gate.' }
  }

  const horizon = normalizedHorizon(options.networkState?.horizonYear ?? corridor.rolloutYear)
  const candidates = artifact.records.filter(
    (record) => record.corridorId === corridor.id && record.rolloutYear === horizon,
  )
  if (candidates.length === 0) {
    return { warning: 'No trained prediction exists for this corridor and horizon.' }
  }
  const normalizedInputs = normalizeScoreInputs(corridor.inputs)
  const inputAndPortfolioMatch = candidates.find(
    (record) =>
      scoreInputsMatch(record.inputScores, normalizedInputs) &&
      (!options.networkState ||
        sameStringSet(
          record.activeCorridorIds,
          options.networkState.activeCorridorIds,
        )),
  )
  if (!inputAndPortfolioMatch) {
    const hasInputMatch = candidates.some((record) =>
      scoreInputsMatch(record.inputScores, normalizedInputs),
    )
    if (hasInputMatch && options.networkState) {
      return {
        warning:
          'Active portfolio state does not match a precomputed model scenario; synthetic fallback used.',
      }
    }
    return {
      warning:
        'Edited scores do not match the precomputed model feature snapshot; synthetic fallback used.',
    }
  }
  if (!options.networkState && inputAndPortfolioMatch.activeCorridorIds.length > 0) {
    return {
      warning:
        'Prediction requires an explicit active portfolio state; synthetic fallback used.',
    }
  }
  if (
    !isValidSvgMotionPath(inputAndPortfolioMatch.beforePath) ||
    !isValidSvgMotionPath(inputAndPortfolioMatch.afterPath)
  ) {
    return { warning: 'Prediction artifact contains an invalid SVG route path.' }
  }
  return { artifact, record: inputAndPortfolioMatch }
}

function createAgents(
  corridorId: string,
  beforePath: string,
  afterPath: string,
  count: number,
  seed: number,
  representedTrips: number,
): SimulatedAgent[] {
  if (!Number.isFinite(representedTrips) || representedTrips <= 0) return []
  const random = seededRandom(seed)
  const totalTrips = Math.round(representedTrips)
  if (totalTrips <= 0) return []
  const safeCount = Math.min(
    100,
    totalTrips,
    Math.max(1, Math.round(count)),
  )
  const baseWeight = Math.floor(totalTrips / safeCount)
  const remainder = totalTrips - baseWeight * safeCount

  return Array.from({ length: safeCount }, (_, index) => {
    return {
      id: `${corridorId}-agent-${String(index + 1).padStart(2, '0')}`,
      delay: roundTo(index * 0.13 + random() * 0.38, 2),
      path: afterPath,
      beforePath,
      afterPath,
      weight: baseWeight + (index < remainder ? 1 : 0),
      weightUnit: 'weighted-trips-per-weekday' as const,
      semantics: 'representative-rerouted-demand' as const,
    }
  })
}

function createArtifactSimulation(
  corridor: Corridor,
  artifact: CorridorPredictionArtifact,
  record: CorridorPredictionRecord,
): CorridorSimulation {
  const scoring = evaluateScore(corridor.inputs)
  return {
    before: { ...record.before },
    after: { ...record.after },
    agents: createAgents(
      corridor.id,
      record.beforePath,
      record.afterPath,
      record.representativeAgentCount,
      record.agentSeed,
      record.after.lowStressTrips - record.before.lowStressTrips,
    ),
    scoring,
    mode: 'trained-artifact',
    artifactId: artifact.artifactId,
    disclaimer:
      'Deprecated v1 precomputed scenario; migrate to velocity.corridor-demand.v2 and B-owned routing. Relative estimates remain decision support, not causal forecasts or official recommendations.',
    warnings: ['Deprecated simulation-heavy v1 artifact; this compatibility path does not implement the canonical A→B handoff.'],
  }
}

/**
 * Creates a visibly separate proxy for the pre-build route. Fixture paths use
 * absolute M/C commands; unsupported path forms safely remain unchanged.
 */
function createFallbackBeforePath(afterPath: string, seed: number): string {
  if (!/^[\sMLCQSTZ0-9.,+-]+$/.test(afterPath) || /[a-z]/.test(afterPath)) {
    return afterPath
  }
  const offsetX = seed % 2 === 0 ? -18 : 18
  const offsetY = seed % 3 === 0 ? 22 : -22
  let coordinateIndex = 0
  const translated = afterPath.replace(
    /[-+]?(?:\d+\.?\d*|\.\d+)/g,
    (token) => {
      const translatedValue =
        Number(token) + (coordinateIndex % 2 === 0 ? offsetX : offsetY)
      coordinateIndex += 1
      return roundTo(translatedValue, 2).toString()
    },
  )
  return isValidSvgMotionPath(translated) ? translated : afterPath
}

function createSyntheticSimulation(
  corridor: Corridor,
  options: SimulationOptions,
  warning?: string,
): CorridorSimulation {
  const inputs = normalizeScoreInputs(corridor.inputs)
  const scoring = evaluateScore(inputs)
  const horizon = normalizedHorizon(options.networkState?.horizonYear ?? corridor.rolloutYear)
  const activeCorridorCount = Array.isArray(options.networkState?.activeCorridorIds)
    ? new Set(options.networkState.activeCorridorIds).size
    : 0
  const networkSynergy = 1 + Math.min(0.12, activeCorridorCount * 0.02)
  const horizonMaturity = 0.72 + (horizon - 1) * 0.14

  // High safety/barrier values mean high existing need, so they correctly
  // increase today's high-stress count and the potential reduction.
  const before: SimulationMetrics = {
    lowStressTrips: boundedInteger(
      120 + inputs.currentDemand * 7.4 + inputs.connectivity * 1.8,
      10_000_000,
    ),
    populationConnected: boundedInteger(
      4_500 +
        inputs.connectivity * 145 +
        inputs.transit * 70 +
        (100 - inputs.coverage) * 55,
      20_000_000,
    ),
    destinationsReached: boundedInteger(
      2 + inputs.destinations * 0.14 + inputs.connectivity * 0.045,
      1_000_000,
    ),
    dangerousSegments: boundedInteger(
      2 + inputs.safety * 0.09 + inputs.barriers * 0.045,
      1_000_000,
    ),
  }

  const tripUplift =
    (0.07 +
      inputs.potentialDemand * 0.003 +
      inputs.connectivity * 0.0012 +
      inputs.transit * 0.0007) *
    horizonMaturity *
    networkSynergy
  const connectedGain =
    (1_800 +
      inputs.coverage * 105 +
      inputs.equity * 75 +
      inputs.connectivity * 45) *
    horizonMaturity *
    networkSynergy
  const destinationGain =
    (inputs.destinations * 0.065 +
      inputs.connectivity * 0.028 +
      inputs.transit * 0.018) *
    horizonMaturity *
    networkSynergy
  const dangerousReduction =
    before.dangerousSegments *
    (0.28 + inputs.safety * 0.0035 + inputs.barriers * 0.0015) *
    horizonMaturity

  const after: SimulationMetrics = {
    lowStressTrips: boundedInteger(
      Math.max(before.lowStressTrips, before.lowStressTrips * (1 + tripUplift)),
      10_000_000,
    ),
    populationConnected: boundedInteger(
      Math.max(before.populationConnected, before.populationConnected + connectedGain),
      20_000_000,
    ),
    destinationsReached: boundedInteger(
      Math.max(before.destinationsReached, before.destinationsReached + destinationGain),
      1_000_000,
    ),
    dangerousSegments: boundedInteger(
      Math.min(before.dangerousSegments, before.dangerousSegments - dangerousReduction),
      1_000_000,
    ),
  }

  const fallbackPath = 'M 80 350 C 250 260 430 250 620 170'
  const afterPath = isValidSvgMotionPath(corridor.path)
    ? corridor.path
    : fallbackPath
  const scoreSeed = Math.round(scoring.meanScore * 10)
  const seed = hashString(`${corridor.id}:${horizon}:${scoreSeed}`)
  const beforePath = createFallbackBeforePath(afterPath, seed)
  const agentCount = Math.min(
    28,
    Math.max(8, Math.round(8 + inputs.potentialDemand / 7)),
  )

  return {
    before,
    after,
    agents: createAgents(
      corridor.id,
      beforePath,
      afterPath,
      agentCount,
      seed,
      after.lowStressTrips - before.lowStressTrips,
    ),
    scoring,
    mode: 'synthetic-fallback',
    disclaimer: SYNTHETIC_SIMULATION_DISCLAIMER,
    warnings: warning ? [warning] : undefined,
  }
}

function isCorridorActive(
  corridor: Corridor,
  options: SimulationOptions,
): boolean {
  if (options.networkState) {
    return Array.isArray(options.networkState.activeCorridorIds) && options.networkState.activeCorridorIds.includes(corridor.id)
  }
  // A trained prediction must never infer construction state from the same
  // field used as the scenario horizon. Legacy fallback callers remain
  // compatible, while artifact callers must provide plan timing or a state.
  if (options.artifact && corridor.plannedRolloutYear === undefined) return false
  const horizon = normalizedHorizon(corridor.rolloutYear)
  const plannedYear = corridor.plannedRolloutYear ?? horizon
  return horizon >= plannedYear
}

function createInactiveSimulation(
  corridor: Corridor,
  options: SimulationOptions,
): CorridorSimulation {
  const baseline = createSyntheticSimulation(corridor, options)
  return {
    ...baseline,
    after: { ...baseline.before },
    agents: [],
    warnings: [
      'Corridor is not active in this portfolio state; no build effect was applied.',
    ],
  }
}

/**
 * Stable UI entry point. Cached corridor tier/mean values are deliberately
 * ignored; scoring is always re-derived from the current edited inputs.
 */
export function simulateCorridor(
  corridor: Corridor,
  options: SimulationOptions = {},
): CorridorSimulation {
  const artifact = options.demandArtifact ?? options.artifact
  const isDemand = options.demandArtifact !== undefined || (typeof artifact === 'object' && artifact !== null && 'schemaVersion' in artifact && artifact.schemaVersion === DEMAND_ARTIFACT_SCHEMA_VERSION)
  if (isDemand) {
    const fallback = (warning: string) => {
      const simulation = isCorridorActive(corridor, options)
        ? createSyntheticSimulation(corridor, options, warning)
        : createInactiveSimulation(corridor, options)
      return { ...simulation, warnings: [warning, ...(simulation.warnings ?? []).filter((item) => item !== warning)] }
    }
    const parsed = parseCorridorDemandArtifact(artifact)
    if (!parsed.ok) return fallback(`Demand artifact rejected: ${parsed.errors.join('; ')}`)
    const record = parsed.artifact.records.find((item) => item.corridorId === corridor.id)
    if (!record) return fallback('No trained demand prediction exists for this stable corridor ID.')
    if (!scoreInputsMatch(record.inputScores, normalizeScoreInputs(corridor.inputs))) return fallback('Edited scores do not match the trained model inputs.')
    if (!options.network) return fallback('A valid B-owned routing network is required to generate a demand-weighted scenario.')
    const networkErrors = validateSimulationNetwork(options.network)
    if (networkErrors.length) return fallback(`Invalid B routing network: ${networkErrors.join('; ')}`)
    const predictions = new Map(parsed.artifact.records.map((item) => [item.corridorId, item.prediction.relativeBicyclesPerObservedHour]))
    if (options.network.flows.some((flow) => !predictions.has(flow.corridorId))) return fallback('Missing demand prediction for an OD corridor in the B network.')
    const totalWeight = options.network.flows.reduce((sum, flow) => sum + flow.weight * predictions.get(flow.corridorId)!, 0)
    if (!Number.isFinite(totalWeight)) return fallback('Relative OD demand weights overflow; scenario rejected.')
    if (!options.network.edges.some((edge) => edge.corridorId === corridor.id)) return fallback('Selected corridor has no mapped edges in the B routing network.')
    const state = options.networkState
    const known = new Set(options.network.edges.flatMap((edge) => edge.corridorId ? [edge.corridorId] : []))
    if (!state || ![1, 2, 3].includes(state.horizonYear) || !Array.isArray(state.activeCorridorIds) || new Set(state.activeCorridorIds).size !== state.activeCorridorIds.length || !state.activeCorridorIds.every((id) => known.has(id))) return fallback('Explicit portfolio state must have horizon 1–3 and unique known corridor IDs.')
    return simulateDemandNetwork(corridor, parsed.artifact, options.network, state)
  }
  if (!isCorridorActive(corridor, options)) {
    return createInactiveSimulation(corridor, options)
  }
  const prediction = findUsablePrediction(corridor, options)
  if (prediction.record && prediction.artifact) {
    return createArtifactSimulation(
      corridor,
      prediction.artifact,
      prediction.record,
    )
  }
  return createSyntheticSimulation(corridor, options, prediction.warning)
}

/** Safe bootstrap adapter for a fetched/imported JSON artifact. */
export function createArtifactAwareSimulator(
  artifact: unknown,
  networkState?: PortfolioNetworkState,
  network?: SimulationNetwork,
): (corridor: Corridor) => CorridorSimulation {
  return (corridor) => simulateCorridor(corridor, { artifact, networkState, network })
}
