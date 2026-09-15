/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseCorridorPredictionArtifact,
  type CorridorPredictionArtifact,
} from './corridorArtifact.ts'
import type { Corridor } from './corridorDomain.ts'
import {
  isValidSvgMotionPath,
  simulateCorridor,
} from './corridorSimulation.ts'
import {
  calculateWeightedScore,
  determineTier,
  evaluateScore,
  normalizeScoreInputs,
  type ScoreInputs,
} from './corridorScoring.ts'

const allScores = (value: number): ScoreInputs => ({
  safety: value,
  connectivity: value,
  equity: value,
  currentDemand: value,
  potentialDemand: value,
  transit: value,
  barriers: value,
  coverage: value,
  destinations: value,
})

const makeCorridor = (overrides: Partial<Corridor> = {}): Corridor => ({
  id: 'test-corridor',
  name: 'Test Corridor',
  subtitle: 'A to B',
  tier: 'Low',
  meanScore: 0,
  inputs: allScores(60),
  path: 'M 10 20 C 30 40 50 60 70 80',
  color: '#000000',
  rolloutYear: 1,
  plannedRolloutYear: 1,
  summary: 'Test only',
  ...overrides,
})

function artifactFixture(): unknown {
  return {
    schemaVersion: 'velocity.corridor-predictions.v1',
    artifactId: 'artifact-2026-09-15',
    generatedAt: '2026-09-15T12:00:00Z',
    model: {
      id: 'corridor-demand-model',
      version: '1.0.0',
      trainedAt: '2026-09-15T11:00:00Z',
      datasetManifestVersion: 'datasets-1',
      target: 'relative-bicycles-per-observed-hour',
      validation: {
        strategy: 'spatial-holdout',
        metric: 'mae',
        modelValue: 8,
        medianBaselineValue: 10,
        lowerIsBetter: true,
      },
    },
    records: [
      {
        corridorId: 'test-corridor',
        rolloutYear: 1,
        inputScores: allScores(60),
        before: {
          lowStressTrips: 500,
          populationConnected: 10_000,
          destinationsReached: 12,
          dangerousSegments: 8,
        },
        after: {
          lowStressTrips: 700,
          populationConnected: 15_000,
          destinationsReached: 18,
          dangerousSegments: 3,
        },
        representativeAgentCount: 10,
        agentSeed: 42,
        beforePath: 'M 10 40 C 30 60 50 80 70 100',
        afterPath: 'M 10 20 C 30 40 50 60 70 80',
        candidateProvenance: {
          kind: 'plan-backed',
          sourceName: 'City of Toronto Cycling Network Plan',
          sourceUrl:
            'https://www.toronto.ca/services-payments/streets-parking-transportation/cycling-in-toronto/cycling-infrastructure-definitions/cycling-network-plan/',
          sourceRecordId: 'candidate-1',
        },
        observedDemandProvenance: {
          kind: 'bike-share-od',
          sourceName: 'Bike Share Toronto OD',
          sourceUrl:
            'https://open.toronto.ca/gallery-item/mapping-bike-share-trips-in-toronto/',
          observationStart: '2024-06-01',
          observationEnd: '2024-06-30',
          tripCount: 1000,
        },
        activeCorridorIds: [],
      },
    ],
  }
}

test('normalization and weighted scoring clamp malformed runtime data', () => {
  const normalized = normalizeScoreInputs({
    safety: 130,
    connectivity: -2,
    equity: Number.NaN,
  })
  assert.equal(normalized.safety, 100)
  assert.equal(normalized.connectivity, 0)
  assert.equal(normalized.equity, 0)
  assert.equal(normalized.destinations, 0)
  assert.ok(calculateWeightedScore(normalized) >= 0)
  assert.ok(calculateWeightedScore(normalized) <= 100)
})

test('tier gates and core-weakness cap match the published rubric', () => {
  assert.equal(determineTier(allScores(60)), 'Top')
  assert.equal(determineTier({ ...allScores(60), safety: 39 }), 'High')
  assert.equal(
    determineTier({ ...allScores(59), safety: 60, connectivity: 60, potentialDemand: 60, equity: 60 }),
    'Medium',
  )
  assert.equal(determineTier(allScores(0)), 'Low')
})

test('simulation recomputes stale score fields and is deterministic', () => {
  const corridor = makeCorridor({ tier: 'Low', meanScore: 1 })
  const first = simulateCorridor(corridor)
  const second = simulateCorridor(corridor)
  assert.deepEqual(first, second)
  assert.deepEqual(first.scoring, evaluateScore(corridor.inputs))
  assert.equal(first.scoring?.tier, 'Top')
  assert.equal(first.mode, 'synthetic-fallback')
  assert.match(first.disclaimer ?? '', /Synthetic deterministic fallback/)
  assert.ok(first.agents.every((agent) => isValidSvgMotionPath(agent.path)))
  assert.ok(first.agents.every((agent) => agent.beforePath !== agent.afterPath))
  assert.ok(first.agents.every((agent) => (agent.weight ?? -1) >= 0))
})

test('safety need and rollout horizon have coherent metric direction', () => {
  const lowNeed = simulateCorridor(makeCorridor({ inputs: allScores(10), rolloutYear: 1 }))
  const highNeed = simulateCorridor(
    makeCorridor({
      inputs: { ...allScores(10), safety: 100, barriers: 100 },
      rolloutYear: 1,
    }),
  )
  assert.ok(highNeed.before.dangerousSegments > lowNeed.before.dangerousSegments)
  assert.ok(highNeed.after.dangerousSegments <= highNeed.before.dangerousSegments)

  const yearOne = simulateCorridor(makeCorridor({ rolloutYear: 1 }))
  const yearThree = simulateCorridor(makeCorridor({ rolloutYear: 3 }))
  assert.ok(
    yearThree.after.lowStressTrips - yearThree.before.lowStressTrips >
      yearOne.after.lowStressTrips - yearOne.before.lowStressTrips,
  )
})

test('trained artifacts are schema-checked, gated, and only used for matching inputs', () => {
  const parsed = parseCorridorPredictionArtifact(artifactFixture())
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.artifact.model.productionEligible, true)
  const modeled = simulateCorridor(makeCorridor(), { artifact: parsed.artifact })
  assert.equal(modeled.mode, 'trained-artifact')
  assert.equal(modeled.before.lowStressTrips, 500)
  assert.equal(modeled.after.lowStressTrips, 700)
  assert.equal(modeled.agents[0]?.weight, 20)
  assert.equal(
    modeled.agents.reduce((total, agent) => total + (agent.weight ?? 0), 0),
    200,
  )

  const edited = simulateCorridor(
    makeCorridor({ inputs: { ...allScores(60), connectivity: 61 } }),
    { artifact: parsed.artifact },
  )
  assert.equal(edited.mode, 'synthetic-fallback')
  assert.match(edited.warnings?.[0] ?? '', /feature snapshot/)
})

test('runtime revalidates constructed artifacts instead of trusting eligibility flags', () => {
  const parsed = parseCorridorPredictionArtifact(artifactFixture())
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const forged: CorridorPredictionArtifact = {
    ...parsed.artifact,
    model: {
      ...parsed.artifact.model,
      productionEligible: true,
      validation: {
        ...parsed.artifact.model.validation,
        modelValue: 99,
        medianBaselineValue: 1,
      },
    },
  }
  const simulation = simulateCorridor(makeCorridor(), { artifact: forged })
  assert.equal(simulation.mode, 'synthetic-fallback')
  assert.match(simulation.warnings?.[0] ?? '', /baseline gate/)
})

test('portfolio-state variants coexist and select the exact active set', () => {
  const raw = artifactFixture()
  assert.equal(typeof raw, 'object')
  if (typeof raw !== 'object' || raw === null) return
  const records = Reflect.get(raw, 'records')
  if (!Array.isArray(records) || typeof records[0] !== 'object' || records[0] === null) return
  const portfolioVariant = structuredClone(records[0])
  Reflect.set(portfolioVariant, 'activeCorridorIds', [
    'network-a',
    'test-corridor',
  ])
  const after = Reflect.get(portfolioVariant, 'after')
  if (typeof after !== 'object' || after === null) return
  Reflect.set(after, 'lowStressTrips', 800)
  records.push(portfolioVariant)

  const parsed = parseCorridorPredictionArtifact(raw)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const simulation = simulateCorridor(makeCorridor(), {
    artifact: parsed.artifact,
    networkState: {
      horizonYear: 1,
      activeCorridorIds: ['test-corridor', 'network-a'],
    },
  })
  assert.equal(simulation.mode, 'trained-artifact')
  assert.equal(simulation.after.lowStressTrips, 800)

  const duplicateState = simulateCorridor(makeCorridor(), {
    artifact: parsed.artifact,
    networkState: {
      horizonYear: 1,
      activeCorridorIds: ['test-corridor', 'test-corridor'],
    },
  })
  assert.equal(duplicateState.mode, 'synthetic-fallback')
})

test('a model that does not beat the spatial median baseline is never served', () => {
  const raw = artifactFixture()
  assert.equal(typeof raw, 'object')
  if (typeof raw !== 'object' || raw === null) return
  const model = Reflect.get(raw, 'model')
  if (typeof model !== 'object' || model === null) return
  const validation = Reflect.get(model, 'validation')
  if (typeof validation !== 'object' || validation === null) return
  Reflect.set(validation, 'modelValue', 11)

  const parsed = parseCorridorPredictionArtifact(raw)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.artifact.model.productionEligible, false)
  const simulation = simulateCorridor(makeCorridor(), {
    artifact: parsed.artifact as CorridorPredictionArtifact,
  })
  assert.equal(simulation.mode, 'synthetic-fallback')
  assert.match(simulation.warnings?.[0] ?? '', /baseline gate/)
})

test('invalid metrics and provenance are rejected instead of silently served', () => {
  const raw = artifactFixture()
  assert.equal(typeof raw, 'object')
  if (typeof raw !== 'object' || raw === null) return
  const records = Reflect.get(raw, 'records')
  if (!Array.isArray(records) || typeof records[0] !== 'object' || records[0] === null) return
  const after = Reflect.get(records[0], 'after')
  if (typeof after !== 'object' || after === null) return
  Reflect.set(after, 'dangerousSegments', 99)
  const parsed = parseCorridorPredictionArtifact(raw)
  assert.equal(parsed.ok, false)
  if (parsed.ok) return
  assert.ok(parsed.errors.some((error) => error.includes('dangerousSegments')))
})

test('present-but-malformed provenance fields and impossible dates fail closed', () => {
  const raw = artifactFixture()
  assert.equal(typeof raw, 'object')
  if (typeof raw !== 'object' || raw === null) return
  Reflect.set(raw, 'generatedAt', '2026-02-30')
  const records = Reflect.get(raw, 'records')
  if (!Array.isArray(records) || typeof records[0] !== 'object' || records[0] === null) return
  const demand = Reflect.get(records[0], 'observedDemandProvenance')
  if (typeof demand !== 'object' || demand === null) return
  Reflect.set(demand, 'tripCount', -1)
  Reflect.set(records[0], 'activeCorridorIds', ['valid', 42, ''])

  const parsed = parseCorridorPredictionArtifact(raw)
  assert.equal(parsed.ok, false)
  if (parsed.ok) return
  assert.ok(parsed.errors.some((error) => error.includes('valid calendar date')))
  assert.ok(parsed.errors.some((error) => error.includes('tripCount')))
  assert.ok(parsed.errors.some((error) => error.includes('activeCorridorIds')))
})

test('SVG validation enforces arc flags and representative agents conserve tiny uplift', () => {
  assert.equal(isValidSvgMotionPath('M0 0 A10 10 0 2 2 20 20'), false)
  assert.equal(isValidSvgMotionPath('M0 0 A10 10 0 1 0 20 20'), true)

  const raw = artifactFixture()
  assert.equal(typeof raw, 'object')
  if (typeof raw !== 'object' || raw === null) return
  const records = Reflect.get(raw, 'records')
  if (!Array.isArray(records) || typeof records[0] !== 'object' || records[0] === null) return
  Reflect.set(records[0], 'representativeAgentCount', 100)
  const after = Reflect.get(records[0], 'after')
  if (typeof after !== 'object' || after === null) return
  Reflect.set(after, 'lowStressTrips', 501)
  const parsed = parseCorridorPredictionArtifact(raw)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const simulation = simulateCorridor(makeCorridor(), { artifact: parsed.artifact })
  assert.equal(
    simulation.agents.reduce(
      (total, agent) => total + (agent.weight ?? 0),
      0,
    ),
    1,
  )
})

test('planned rollout and explicit portfolio state suppress pre-build effects', () => {
  const plannedLater = makeCorridor({ rolloutYear: 1, plannedRolloutYear: 3 })
  const preBuild = simulateCorridor(plannedLater)
  assert.deepEqual(preBuild.after, preBuild.before)
  assert.equal(preBuild.agents.length, 0)

  const excluded = simulateCorridor(makeCorridor(), {
    networkState: { horizonYear: 3, activeCorridorIds: ['someone-else'] },
  })
  assert.deepEqual(excluded.after, excluded.before)
  assert.match(excluded.warnings?.[0] ?? '', /not active/)
})

test('trained artifacts require explicit plan timing or portfolio state', () => {
  const parsed = parseCorridorPredictionArtifact(artifactFixture())
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const missingPlanYear = makeCorridor({ plannedRolloutYear: undefined })
  const simulation = simulateCorridor(missingPlanYear, {
    artifact: parsed.artifact,
  })
  assert.equal(simulation.mode, 'synthetic-fallback')
  assert.deepEqual(simulation.after, simulation.before)
  assert.equal(simulation.agents.length, 0)
})
