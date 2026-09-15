import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareB, validateBundle, validateCanonicalBundle } from './prepare-b.mjs'
import { hashFeatureSnapshot } from '../src/lib/corridorDemandArtifact.ts'
import { SCORE_KEYS } from '../src/lib/corridorScoring.ts'
import { buildGraph, adjacency, route, matchCandidate, bicycleAllowed, bicycleDirectional } from './b-osm-graph.mjs'

function input() {
  const coords = Array.from({ length: 60 }, (_, i) => [-79.42 + i * 0.001, 43.66])
  const station = (i) => ({ station_id: String(i), lon: coords[i][0], lat: coords[i][1] })
  return {
    raw: { type: 'FeatureCollection', features: [{ properties: { SEGMENT_ID: 1 }, geometry: { type: 'LineString', coordinates: coords } }] },
    flows: { data_status: 'observed', period: '2024-06', flows: Array.from({ length: 50 }, (_, i) => ({ origin: station(0), destination: station(i), trip_count: i + 1 })) },
    osm: { osm3s: { timestamp_osm_base: '2026-09-15T00:00:00Z' }, elements: [...coords.map((p, i) => ({ type: 'node', id: i + 1, lon: p[0], lat: p[1] })), { type: 'way', id: 1, nodes: coords.map((_, i) => i + 1), tags: { highway: 'residential' } }] },
    candidates: { features: [{ properties: { corridor_id: 'test', name: 'Test', candidate_type: 'plan_backed', data_status: 'fixture', scores: { safety: 60, connectivity: 60, equity_population: 60, current_demand: 60, potential_demand: 60, transit: 60, barriers: 60, coverage: 60, destinations: 60 } }, geometry: { type: 'LineString', coordinates: [coords[0], coords[59]] } }] },
    source: { title: 'Test source', download_url: 'https://example.com/network' },
    checksums: { network: 'a'.repeat(64), osm: 'd'.repeat(64), flows: 'b'.repeat(64), candidates: 'c'.repeat(64), sourceManifest: 'e'.repeat(64) },
  }
}

function validDemand() {
  const features = { version: 'f1', raw: { observed: 10 }, normalized: Object.fromEntries(SCORE_KEYS.map((k) => [k, 60])) }
  const demand = {
    schemaVersion: 'velocity.corridor-demand.v2', artifactId: 'test-demand', generatedAt: '2026-09-15',
    model: { id: 'test', version: '1', trainedAt: '2026-09-15', datasetManifestVersion: 'd1', featureVersion: 'f1', target: 'relative-bicycles-per-observed-hour', unit: 'dimensionless-relative-hourly-demand', normalization: { referenceBicyclesPerHour: 10, fittedOn: 'training-only' }, productionEligible: true, validation: { strategy: 'spatial-holdout', grouping: 'corridor', metric: 'mae', modelValue: 1, medianBaselineValue: 2, baseline: 'training-median', lowerIsBetter: true, trainGroupIds: ['train'], testGroupIds: ['test'] } },
    records: [{ corridorId: 'test', prediction: 2, uncertainty: { lower: 1, upper: 3, coverage: 0.9 }, features: { ...features, hash: hashFeatureSnapshot(features) }, observedDemandProvenance: { kind: 'bike-share-od', sourceName: 'Test source', sourceUrls: ['https://example.com/od'], observationStart: '2024-06-01', observationEnd: '2024-06-30', observedHours: 720 }, candidate: { kind: 'exploratory', sourceName: 'Test', sourceUrl: 'https://example.com/candidate', geometry: input().candidates.features[0].geometry } }],
  }
  return demand
}

test('deterministic stable graph IDs and sample; preserves OD accounting and caps', async () => {
  const data = input(), first = prepareB(data)
  assert.deepEqual(first, prepareB(structuredClone(data)))
  data.flows.flows.reverse()
  assert.deepEqual(first, prepareB(data))
  const n = first.networks[0]
  assert.equal(n.status, 'ready')
  assert.ok(n.partitions.every((p) => p.network.nodes.length <= 48 && p.network.edges.length <= 128))
  assert.ok(n.accounting.cappedTrips > 0)
  assert.ok(n.accounting.sameNodeTrips > 0)
  await validateBundle(first)
  n.accounting.retainedTrips++
  await assert.rejects(validateBundle(first), /conserve/)
})

test('fixture plan_backed input cannot become verified; absent and invalid A block scenarios', () => {
  const result = prepareB(input())
  assert.equal(result.networks[0].candidateStatus, 'synthetic-fixture')
  assert.equal(result.networks[0].partitions[0].network.isIllustrative, false)
  assert.equal(result.scenarios[0].status, 'blocked')
  assert.deepEqual(result.scenarios[0].simulations, [])
  const invalid = prepareB({ ...input(), demand: { schemaVersion: 'velocity.corridor-demand.v2' } })
  assert.equal(invalid.demandStatus, 'blocked')
  assert.ok(invalid.demandErrors.length)
})

test('missing raw, unobserved OD and unsupported CRS fail visibly', () => {
  assert.throws(() => prepareB({ ...input(), raw: undefined }), /raw/)
  const data = input()
  data.raw.crs = { properties: { name: 'EPSG:3857' } }
  assert.throws(() => prepareB(data), /CRS/)
  assert.throws(() => prepareB({ ...input(), flows: { data_status: 'fixture' } }), /Observed/)
})

test('valid A handoff runs B scenario engine and conserves relative demand', () => {
  const demand = validDemand()
  const result = prepareB({ ...input(), demand })
  assert.equal(result.demandStatus, 'validated')
  const scenario = result.scenarios[0]
  assert.equal(scenario.status, 'precomputed')
  assert.ok(Math.abs(scenario.simulations.reduce((sum, p) => sum + p.simulation.routes.reduce((s, r) => s + r.weight, 0), 0) - 2) < 1e-9)
  assert.equal(scenario.simulations[0].simulation.networkProvenance.isIllustrative, false)
  demand.records[0].corridorId = 'unrelated'
  const unrelated = prepareB({ ...input(), demand })
  assert.equal(unrelated.demandStatus, 'blocked')
  assert.equal(unrelated.scenarios[0].status, 'blocked')
  demand.records[0].corridorId = 'test'
  delete demand.records[0].candidate.geometry
  assert.equal(prepareB({ ...input(), demand }).demandStatus, 'blocked')
})

test('OSM identities, bicycle permissions and stress tags determine graph topology', () => {
  const data = input()
  const way = data.osm.elements.find((e) => e.type === 'way')
  let graph = buildGraph(data.osm, data.raw)
  assert.ok(graph.edges.every((e) => !e.highStress))
  way.tags.highway = 'primary'
  graph = buildGraph(data.osm, data.raw)
  assert.ok(graph.edges.every((e) => e.highStress))
  way.tags.oneway = 'yes'
  assert.equal(buildGraph(data.osm, data.raw).edges.length, 0)
  way.tags['oneway:bicycle'] = 'no'
  assert.ok(buildGraph(data.osm, data.raw).edges.length > 0)
  way.tags.bicycle = 'no'
  assert.equal(buildGraph(data.osm, data.raw).edges.length, 0)
})

test('OSM bicycle allowlist, access hierarchy and direction rules are conservative', () => {
  for (const highway of ['motorway', 'trunk', 'construction', 'proposed', 'steps', 'corridor', 'elevator', 'platform', 'bus_stop']) assert.equal(bicycleAllowed({ highway }), false, highway)
  assert.equal(bicycleAllowed({ highway: 'residential', access: 'no', bicycle: 'yes' }), true)
  assert.equal(bicycleAllowed({ highway: 'residential', vehicle: 'no', bicycle: 'designated' }), true)
  assert.equal(bicycleAllowed({ highway: 'residential', access: 'yes', vehicle: 'no' }), false)
  assert.equal(bicycleAllowed({ highway: 'cycleway', access: 'private', bicycle: 'yes' }), true)
  assert.equal(bicycleAllowed({ highway: 'cycleway', bicycle: 'no' }), false)
  assert.equal(bicycleAllowed({ highway: 'footway' }), false)
  assert.equal(bicycleAllowed({ highway: 'footway', bicycle: 'designated' }), true)
  assert.equal(bicycleAllowed({ highway: 'service', indoor: 'yes', bicycle: 'yes' }), false)

  assert.equal(bicycleDirectional({ highway: 'residential', oneway: 'yes' }), true)
  assert.equal(bicycleDirectional({ highway: 'residential', oneway: '-1' }), true)
  assert.equal(bicycleDirectional({ highway: 'residential', oneway: 'no', 'oneway:bicycle': 'yes' }), true)
  assert.equal(bicycleDirectional({ highway: 'residential', oneway: 'yes', 'oneway:bicycle': 'no' }), false)
  assert.equal(bicycleDirectional({ highway: 'residential', oneway: 'yes', cycleway: 'opposite_lane' }), false)
  assert.equal(bicycleDirectional({ highway: 'residential', oneway: 'yes', 'cycleway:left': 'opposite_track' }), false)
  assert.equal(bicycleDirectional({ highway: 'residential', oneway: 'yes', 'cycleway:left': 'lane', 'cycleway:left:oneway': '-1' }), false)
  assert.equal(bicycleDirectional({ highway: 'residential', oneway: 'no', 'oneway:bicycle': '-1' }), true)
  assert.equal(bicycleDirectional({ highway: 'residential', 'oneway:bicycle:conditional': 'yes @ (Mo-Fr)' }), true)
  assert.equal(bicycleDirectional({ highway: 'residential', junction: 'roundabout' }), true)
  assert.equal(bicycleDirectional({ highway: 'residential', junction: 'roundabout', oneway: 'no' }), false)
})

test('candidate conversion tags only its matched path; route partitions retain full OSM paths', () => {
  const data = input(), graph = buildGraph(data.osm, data.raw)
  graph.adjacency = adjacency(graph)
  const match = matchCandidate(graph, data.candidates.features[0].geometry.coordinates)
  assert.equal(match.edgeIds.length, 59)
  const result = prepareB(data)
  for (const p of result.networks[0].partitions) {
    const flow = p.network.flows[0]
    const full = route(graph, flow.from, flow.to)
    assert.deepEqual(new Set(p.network.edges.map((e) => e.id)), new Set(full.edges.map((e) => e.id)))
    assert.ok(p.network.edges.filter((e) => e.corridorId).every((e) => match.edgeIds.includes(e.id)))
  }
})

test('disconnected demand is accounted before normalization and blocked topology exports no network', () => {
  const data = input(), way = data.osm.elements.find((e) => e.type === 'way')
  const ids = [...way.nodes]
  way.nodes = ids.slice(0, 20)
  data.osm.elements.push({ ...way, id: 2, nodes: ids.slice(20) })
  const result = prepareB(data), n = result.networks[0]
  assert.ok(n.accounting.disconnectedTrips > 0)
  assert.equal(n.status, 'blocked')
  assert.deepEqual(n.partitions, [])
  assert.throws(() => prepareB({ ...input(), osm: undefined }), /OSM/)
})

test('schema and semantics reject readiness, portfolio, demand and disconnected partition tampering', async () => {
  const base = prepareB(input())
  const mutations = [
    (b) => { b.networks[0].partitions = [] },
    (b) => { b.networks[0].errors = ['failed'] },
    (b) => { b.networks[0].status = 'blocked' },
    (b) => { b.demandStatus = 'validated' },
    (b) => { b.portfolio.years[0].builtCorridorIds = ['unknown'] },
    (b) => { b.portfolio.years[1].activeCorridorIds = [] },
    (b) => { b.networks[0].partitions[0].network.edges = [] },
    (b) => { b.scenarios[0].status = 'precomputed'; b.scenarios[0].blockers = []; b.scenarios[0].simulations = [{ partitionId: 'bad', simulation: {} }] },
  ]
  for (const mutate of mutations) {
    const bundle = structuredClone(base)
    mutate(bundle)
    await assert.rejects(validateBundle(bundle))
  }
  const incorrectChecksum = structuredClone(base)
  await assert.rejects(validateBundle(incorrectChecksum, process.cwd(), true), /checksum/)
})

test('canonical regeneration rejects graph, match, edge cost and route mutations', () => {
  const data = { ...input(), demand: validDemand() }
  data.checksums.demand = 'f'.repeat(64)
  data.checksums.demandPath = 'public/data/corridor-demand.json'
  const base = prepareB(data)
  const mutations = [
    (bundle) => { bundle.graph.nodes++ },
    (bundle) => { bundle.networks[0].match.edgeIds[0] = 'osm-w-tampered-0' },
    (bundle) => { bundle.networks[0].partitions[0].network.edges[0].minutes += 0.01 },
    (bundle) => { bundle.scenarios[0].simulations[0].simulation.routes[0].before.edgeIds[0] = 'osm-w-tampered-0' },
  ]
  for (const mutate of mutations) {
    const bundle = structuredClone(base)
    mutate(bundle)
    assert.throws(() => validateCanonicalBundle(bundle, data), /Canonical regeneration mismatch/)
  }
})
