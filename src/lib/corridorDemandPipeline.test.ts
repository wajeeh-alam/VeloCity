/// <reference types="node" />
import assert from 'node:assert/strict'
import test from 'node:test'
import { DEMAND_ARTIFACT_SCHEMA_VERSION, DEMAND_TARGET, hashFeatureSnapshot, parseCorridorDemandArtifact, type CorridorDemandArtifact } from './corridorDemandArtifact.ts'
import type { Corridor } from './corridorDomain.ts'
import { simulateCorridor } from './corridorSimulation.ts'
import { generatePortfolioRollout } from './corridorPortfolio.ts'
import type { SimulationNetwork } from './corridorNetworkSimulation.ts'
import { normalizeScoreInputs, SCORE_KEYS } from './corridorScoring.ts'

const scores = normalizeScoreInputs(Object.fromEntries(SCORE_KEYS.map((key) => [key, 55])))
const corridor = (id = 'link'): Corridor => ({ id, name: id, subtitle: '', tier: 'Top', meanScore: 99, inputs: scores, path: 'M 0 0 L 10 10', color: '#000', rolloutYear: 1, plannedRolloutYear: 1, summary: '' })

function artifact(): CorridorDemandArtifact {
  const features = { version: 'features-1', raw: { counter_hourly: 12, bike_share_od: 30 }, normalized: { ...scores } }
  return {
    schemaVersion: DEMAND_ARTIFACT_SCHEMA_VERSION,
    artifactId: 'trained-demand-1',
    generatedAt: '2026-09-15T12:00:00Z',
    model: {
      id: 'counter-model', version: '1', trainedAt: '2026-09-15T11:00:00Z', datasetManifestVersion: 'datasets-1', featureVersion: 'features-1',
      target: DEMAND_TARGET, unit: 'dimensionless-relative-hourly-demand', normalization: { referenceBicyclesPerHour: 10, fittedOn: 'training-only' }, productionEligible: true,
      validation: { strategy: 'spatial-holdout', grouping: 'counter-site', metric: 'mae', modelValue: 0.2, medianBaselineValue: 0.4, baseline: 'training-median', lowerIsBetter: true, trainGroupIds: ['site-a'], testGroupIds: ['site-b'] },
    },
    records: [{
      corridorId: 'link', prediction: 1.25, uncertainty: { lower: 0.8, upper: 1.8, coverage: 0.9 },
      features: { ...features, hash: hashFeatureSnapshot(features) },
      observedDemandProvenance: { kind: 'counter-observation', sourceName: 'Toronto counters', sourceUrls: ['https://open.toronto.ca/'], observationStart: '2024-06-01', observationEnd: '2024-06-30', observedHours: 600 },
    }],
  }
}

function network(): SimulationNetwork {
  return {
    version: 'network-1', sourceName: 'Test network fixture', sourceUrl: 'https://example.com/test-network', accessibilityMinutes: 10, stressPenalty: 3,
    nodes: [
      { id: 'a', x: 0, y: 0, population: 100, destinations: 0 },
      { id: 'b', x: 10, y: 0, population: 0, destinations: 2 },
      { id: 'c', x: 0, y: 10, population: 50, destinations: 0 },
    ],
    edges: [
      { id: 'direct', from: 'a', to: 'b', minutes: 2, highStress: true, corridorId: 'link' },
      { id: 'detour-a', from: 'a', to: 'c', minutes: 6, highStress: false },
      { id: 'detour-b', from: 'c', to: 'b', minutes: 6, highStress: false },
    ],
    flows: [{ id: 'od-a-b', from: 'a', to: 'b', corridorId: 'link', weight: 2.5 }],
  }
}
const state = { horizonYear: 1 as const, activeCorridorIds: ['link'] }
function run(demand: unknown = artifact(), graph = network()) {
  return simulateCorridor(corridor(), { demandArtifact: demand, network: graph, networkState: state })
}

test('A demand handoff contains no simulations; B builds deterministic routes and metric units', () => {
  assert.equal(parseCorridorDemandArtifact(artifact()).ok, true)
  const result = run()
  assert.equal(result.mode, 'trained-artifact')
  assert.deepEqual(result, run())
  assert.deepEqual(result.routes?.[0].before?.edgeIds, ['detour-a', 'detour-b'])
  assert.deepEqual(result.routes?.[0].after?.edgeIds, ['direct'])
  assert.equal(result.metricDefinitions?.lowStressTrips.unit, 'relative-demand-weight')
  assert.equal(result.metricDefinitions?.lowStressTrips.integer, false)
  assert.match(result.disclaimer ?? '', /not absolute trips, causal ridership growth/)
  assert.equal(result.demand?.prediction, 1.25)
  assert.deepEqual(result.networkState, state)
  assert.ok(result.after.populationConnected > result.before.populationConnected)
  assert.ok(result.after.destinationsReached >= result.before.destinationsReached)
  assert.ok(result.after.dangerousSegments < result.before.dangerousSegments)
})

test('relative demand is conserved through route choice and weighted representatives', () => {
  const result = run()
  const expected = 1.25 * 2.5
  assert.equal(result.routes?.[0].weight, expected)
  assert.equal(result.before.lowStressTrips, expected)
  assert.equal(result.after.lowStressTrips, expected)
  assert.ok(Math.abs(result.agents.reduce((sum, agent) => sum + agent.weight!, 0) - expected) < 1e-12)
  assert.ok(result.agents.every((agent) => agent.weightUnit === 'relative-demand-weight' && agent.weight! > 0 && agent.beforePath !== agent.afterPath))
})

test('baseline failures, overlapping groups and false producer gates always fall back', () => {
  for (const mutate of [
    (a: CorridorDemandArtifact) => { a.model.validation.modelValue = 0.4 },
    (a: CorridorDemandArtifact) => { a.model.validation.modelValue = 0.8 },
    (a: CorridorDemandArtifact) => { a.model.productionEligible = false },
    (a: CorridorDemandArtifact) => { a.model.validation.testGroupIds = ['site-a'] },
  ]) {
    const value = artifact(); mutate(value)
    assert.equal(parseCorridorDemandArtifact(value).ok, false)
    const result = run(value)
    assert.equal(result.mode, 'synthetic-fallback')
    assert.match(result.disclaimer ?? '', /Synthetic deterministic fallback/)
    assert.match(result.warnings?.[0] ?? '', /Demand artifact rejected/)
  }
})

test('malformed predictions, uncertainty, IDs, provenance, dates, units, hashes and simulation fields fail closed', () => {
  const mutations: Array<(a: CorridorDemandArtifact) => void> = [
    (a) => { a.records[0].prediction = NaN },
    (a) => { a.records[0].prediction = -1 },
    (a) => { a.records[0].uncertainty.lower = 2 },
    (a) => { a.records[0].uncertainty.coverage = 1 },
    (a) => { a.records.push(structuredClone(a.records[0])) },
    (a) => { a.records[0].corridorId = 'invalid id' },
    (a) => { a.records[0].observedDemandProvenance.observedHours = 0 },
    (a) => { a.records[0].observedDemandProvenance.sourceUrls = ['javascript:bad'] },
    (a) => { a.generatedAt = '2026-02-30' },
    (a) => { a.model.trainedAt = '2027-01-01' },
    (a) => { a.records[0].features.raw.counter_hourly = 13 },
    (a) => { a.records[0].features.version = 'other' },
    (a) => { Reflect.set(a.model, 'unit', 'trips-per-day') },
    (a) => { Reflect.set(a.records[0], 'before', {}) },
    (a) => { a.records = [] },
    (a) => { Reflect.deleteProperty(a.records[0], 'prediction') },
  ]
  for (const mutate of mutations) { const value = artifact(); mutate(value); assert.equal(parseCorridorDemandArtifact(value).ok, false); assert.equal(run(value).mode, 'synthetic-fallback') }
  assert.equal(run(null).mode, 'synthetic-fallback')
})

test('feature hashes ignore object insertion order and edits need a fresh trained snapshot', () => {
  const value = artifact()
  const features = value.records[0].features
  assert.equal(hashFeatureSnapshot(features), hashFeatureSnapshot({ ...features, raw: { bike_share_od: 30, counter_hourly: 12 } }))
  const result = simulateCorridor({ ...corridor(), inputs: { ...scores, safety: 80 } }, { artifact: value, network: network(), networkState: state })
  assert.equal(result.mode, 'synthetic-fallback')
  assert.match(result.warnings?.[0] ?? '', /feature snapshot/)
})

test('missing predictions, mapping, routing inputs and invalid portfolio states visibly fall back', () => {
  const missing = artifact(); missing.records[0].corridorId = 'other'
  assert.match(run(missing).warnings?.[0] ?? '', /stable corridor ID/)
  const graph = network(); graph.flows[0].corridorId = 'other'
  assert.match(run(artifact(), graph).warnings?.[0] ?? '', /Missing demand prediction/)
  graph.flows[0].corridorId = 'link'; graph.edges[0].corridorId = 'other'
  assert.match(run(artifact(), graph).warnings?.[0] ?? '', /no mapped edges/)
  assert.equal(simulateCorridor(corridor(), { demandArtifact: artifact() }).mode, 'synthetic-fallback')
  for (const networkState of [undefined, { ...state, activeCorridorIds: ['unknown'] }, { ...state, activeCorridorIds: ['link', 'link'] }]) {
    const result = simulateCorridor(corridor(), { demandArtifact: artifact(), network: network(), networkState })
    assert.equal(result.mode, 'synthetic-fallback')
    assert.match(result.warnings?.[0] ?? '', /Explicit portfolio state/)
  }
})

test('inactive corridor has no build effect; a stress-only route moves conserved demand to low stress', () => {
  const inactive = simulateCorridor(corridor(), { demandArtifact: artifact(), network: network(), networkState: { ...state, activeCorridorIds: [] } })
  assert.equal(inactive.mode, 'trained-artifact')
  assert.deepEqual(inactive.before, inactive.after)
  assert.deepEqual(inactive.routes?.[0].before, inactive.routes?.[0].after)
  const graph = network(); graph.edges = [graph.edges[0]]
  const built = run(artifact(), graph)
  assert.equal(built.before.lowStressTrips, 0)
  assert.equal(built.after.lowStressTrips, 3.125)
  assert.equal(built.routes?.[0].before?.highStressEdges, 1)
  assert.equal(built.routes?.[0].after?.highStressEdges, 0)
})

test('disconnected OD demand is explicitly unserved, while invalid networks fail closed', () => {
  const graph = network()
  graph.nodes.push({ id: 'd', x: 90, y: 90, population: 0, destinations: 0 })
  graph.flows[0].to = 'd'
  const result = run(artifact(), graph)
  assert.equal(result.routes?.[0].after, null)
  assert.equal(result.agents.length, 0)
  assert.ok(result.warnings?.some((warning) => warning.includes('unserved')))
  graph.edges[0].minutes = -1
  assert.equal(run(artifact(), graph).mode, 'synthetic-fallback')
  Reflect.set(graph, 'nodes', [null])
  assert.equal(run(artifact(), graph).mode, 'synthetic-fallback')
})

test('other built corridors stay active in both scenarios; network input ordering does not change routes', () => {
  const graph = network()
  graph.edges[2].highStress = true
  graph.edges[2].corridorId = 'feeder'
  const withFeeder = simulateCorridor(corridor(), { demandArtifact: artifact(), network: graph, networkState: { ...state, activeCorridorIds: ['link', 'feeder'] } })
  assert.equal(withFeeder.routes?.[0].before?.highStressEdges, 0)
  assert.deepEqual(withFeeder.routes?.[0].before?.edgeIds, ['detour-a', 'detour-b'])
  const reordered = { ...graph, nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() }
  assert.deepEqual(withFeeder, simulateCorridor(corridor(), { demandArtifact: artifact(), network: reordered, networkState: { ...state, activeCorridorIds: ['feeder', 'link'] } }))
})

test('zero demand is valid and yields no weighted agents; unsafe weight overflow fails closed', () => {
  const value = artifact()
  value.records[0].prediction = 0
  value.records[0].uncertainty.lower = 0
  assert.equal(run(value).mode, 'trained-artifact')
  assert.equal(run(value).agents.length, 0)
  const graph = network(); graph.flows[0].weight = Number.MAX_VALUE
  assert.match(run(artifact(), graph).warnings?.[0] ?? '', /overflow/)
})

test('portfolio ranking ignores stale tiers, ties by stable ID, schedules prior-year dependencies', () => {
  const inputs = [{ corridor: corridor('c'), dependsOn: ['b'] }, { corridor: corridor('b'), dependsOn: ['a'] }, { corridor: corridor('a') }]
  const result = generatePortfolioRollout(inputs, 2)
  assert.deepEqual(result, generatePortfolioRollout([...inputs].reverse(), 2))
  assert.deepEqual(result.rankedCorridorIds, ['a', 'b', 'c'])
  assert.deepEqual(result.years.map((year) => year.builtCorridorIds), [['a'], ['b'], ['c']])
  assert.deepEqual(result.years[2].activeCorridorIds, ['a', 'b', 'c'])
  assert.deepEqual(result.unbuiltCorridorIds, [])
  assert.equal(result.years.flatMap((year) => year.builtCorridorIds).length, 3)
})

test('portfolio supports no Top candidates, empty inputs, zero capacity and unsatisfied/cyclic dependencies', () => {
  assert.deepEqual(generatePortfolioRollout([]).years.map((year) => year.builtCorridorIds), [[], [], []])
  assert.deepEqual(generatePortfolioRollout([{ corridor: corridor() }], 0).unbuiltCorridorIds, ['link'])
  const result = generatePortfolioRollout([{ corridor: corridor('a'), dependsOn: ['b'] }, { corridor: corridor('b'), dependsOn: ['a'] }, { corridor: corridor('c'), dependsOn: ['missing'] }])
  assert.deepEqual(result.unbuiltCorridorIds, ['a', 'b', 'c'])
  assert.ok(result.warnings.length >= 2)
  assert.throws(() => generatePortfolioRollout([{ corridor: corridor() }, { corridor: corridor() }]), /unique/)
  assert.throws(() => generatePortfolioRollout([], -1), /capacity/)
})
