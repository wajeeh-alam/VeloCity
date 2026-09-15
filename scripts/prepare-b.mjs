import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import Ajv from 'ajv'
import { validateSimulationNetwork, simulateDemandNetwork } from '../src/lib/corridorNetworkSimulation.ts'
import { parseCorridorDemandArtifact } from '../src/lib/corridorDemandArtifact.ts'
import { generatePortfolioRollout } from '../src/lib/corridorPortfolio.ts'
import { evaluateScore } from '../src/lib/corridorScoring.ts'
import { buildGraph, adjacency, route, snap, matchCandidate, compare } from './b-osm-graph.mjs'

export const digest = (value) => createHash('sha256').update(value).digest('hex')
export const INPUT_FILES = { network: 'data/raw/cycling-network.geojson', osm: 'data/raw/b-osm-network.json', flows: 'public/data/flows.json', candidates: 'public/data/corridors.geojson' }
const assumptions = [
  'OSM node identities and highway ways define connectivity. Geometric crossings are not joined. Forbidden roads and bicycle access restrictions are excluded.',
  'B v1 supports bidirectional edges only: one-way ways without explicit bicycle contraflow permission are omitted. Turn restrictions are not modeled; this is analysis, not navigation guidance.',
  'Stress: cycleways, living streets, bicycle paths, protected tracks, and residential/service streets at assumed or tagged speed <=40 km/h are low stress. Other roads conservatively high stress. Toronto protected infrastructure lowers stress only when both OSM segment endpoints fall within 12m of the same source segment.',
  'Candidate endpoints snap within 150m. Matched paths remain within 300m of candidate geometry and below 1.8 times candidate length. Only edges of that constrained path receive the hypothetical conversion.',
  'Travel time assumes 15km/h; geography uses OSM vertices in EPSG:4326. Population and destinations are unavailable and encoded zero; their metrics are unavailable, not observed zero access.',
  'Each OD partition contains complete fastest and stress-preferred routes before and after building, calculated on the complete acquired graph. Partitions exceeding browser caps are excluded, never truncated.',
  'OD snapping is limited to 200m. Disconnected and same-node pairs are excluded before normalization. Ready requires >=3 retained OD pairs, >=80% connectivity among snapped non-self trips, and >=20% retained coverage of connected trips.',
  'Candidate windows overlap; never sum candidate demand. Portfolio uses existing candidate scores; partitions do not model interaction between builds. Fixture candidates remain unverified.',
  'OSM API tiles were acquired sequentially. The recorded OSM timestamp is acquisition start, not an atomic historical snapshot. Toronto infrastructure and current station positions have different observation dates from June 2024 trips.',
]

export function prepareB({ raw, osm, flows, candidates, source, checksums, demand }) {
  if (raw?.type !== 'FeatureCollection' || !raw.features?.length) throw Error('Missing raw Toronto cycling infrastructure')
  if (raw.crs && !['urn:ogc:def:crs:OGC:1.3:CRS84', 'EPSG:4326', 'urn:ogc:def:crs:EPSG::4326'].includes(raw.crs.properties?.name)) throw Error('Unsupported raw CRS')
  if (flows?.data_status !== 'observed' || !flows.flows?.length) throw Error('Observed OD flows required')
  if (!candidates?.features?.length) throw Error('Candidate geometries required')
  if (osm?.candidatesSha256 && osm.candidatesSha256 !== checksums.candidates) throw Error('OSM acquisition does not match candidate snapshot')
  const graph = buildGraph(osm, raw)
  graph.adjacency = adjacency(graph)
  const parsed = demand === undefined ? { ok: false, errors: ['Missing A artifact: public/data/corridor-demand.json'] } : parseCorridorDemandArtifact(demand)
  const records = new Map(parsed.ok ? parsed.artifact.records.map((r) => [r.corridorId, r]) : [])
  const known = candidates.features.map((f) => f.properties.corridor_id).sort(compare)
  if (new Set(known).size !== known.length) throw Error('Duplicate candidates')
  const demandErrors = parsed.ok ? [] : [...parsed.errors]
  if (parsed.ok) {
    for (const id of known) if (!records.has(id)) demandErrors.push(`Missing demand record: ${id}`)
    for (const id of records.keys()) if (!known.includes(id)) demandErrors.push(`Unexpected demand record: ${id}`)
  }
  const networks = [], scenarios = [], portfolioCandidates = []
  for (const f of [...candidates.features].sort((a, b) => compare(a.properties.corridor_id, b.properties.corridor_id))) {
    const p = f.properties, id = p.corridor_id, coords = f.geometry?.coordinates
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id) || f.geometry?.type !== 'LineString' || coords.length < 2 || !coords.every((p) => p.length === 2 && p.every(Number.isFinite))) throw Error('Invalid candidate geometry/ID')
    const candidateStatus = p.data_status === 'fixture' ? 'synthetic-fixture' : 'exploratory-unverified'
    const s = p.scores
    const inputs = { safety: s.safety, connectivity: s.connectivity, equity: s.equity_population, currentDemand: s.current_demand, potentialDemand: s.potential_demand, transit: s.transit, barriers: s.barriers, coverage: s.coverage, destinations: s.destinations }
    if (!Object.values(inputs).every((v) => Number.isFinite(v) && v >= 0 && v <= 100)) throw Error('Invalid candidate scores')
    const score = evaluateScore(inputs)
    const corridor = { id, name: p.name, inputs, tier: score.tier, meanScore: score.meanScore, subtitle: '', path: '', color: '', rolloutYear: 1, summary: '' }
    portfolioCandidates.push({ corridor })
    const match = matchCandidate(graph, coords), errors = []
    if (!match) errors.push('Candidate cannot be conflated to a constrained connected OSM path')
    const matched = new Set(match?.edgeIds ?? [])
    const localGraph = { nodes: graph.nodes, edges: graph.edges.map((e) => matched.has(e.id) ? { ...e, corridorId: id } : e) }
    localGraph.adjacency = adjacency(localGraph)
    const accounting = { publishedTrips: 0, outsideWindowTrips: 0, sameNodeTrips: 0, disconnectedTrips: 0, cappedTrips: 0, retainedTrips: 0 }
    const prepared = [], cache = new Map()
    const getSnap = (station) => {
      const key = `${station.station_id}:${station.lon}:${station.lat}`
      if (!cache.has(key)) cache.set(key, snap(localGraph, [station.lon, station.lat], 200)?.id)
      return cache.get(key)
    }
    const xs = coords.map((p) => p[0]), ys = coords.map((p) => p[1])
    const inWindow = (s) => s.lon >= Math.min(...xs) - 0.004 && s.lon <= Math.max(...xs) + 0.004 && s.lat >= Math.min(...ys) - 0.004 && s.lat <= Math.max(...ys) + 0.004
    for (const flow of [...flows.flows].sort((a, b) => b.trip_count - a.trip_count || compare(`${a.origin.station_id}:${a.destination.station_id}`, `${b.origin.station_id}:${b.destination.station_id}`))) {
      if (!Number.isSafeInteger(flow.trip_count) || flow.trip_count <= 0) throw Error('Invalid trip count')
      accounting.publishedTrips += flow.trip_count
      if (!inWindow(flow.origin) || !inWindow(flow.destination)) { accounting.outsideWindowTrips += flow.trip_count; continue }
      const from = getSnap(flow.origin), to = getSnap(flow.destination)
      if (!from || !to) { accounting.outsideWindowTrips += flow.trip_count; continue }
      if (from === to) { accounting.sameNodeTrips += flow.trip_count; continue }
      const fastest = route(localGraph, from, to)
      if (!fastest) { accounting.disconnectedTrips += flow.trip_count; continue }
      const before = route(localGraph, from, to, { penalize: true }), after = route(localGraph, from, to, { penalize: true, active: true })
      const nodeIds = new Set([fastest, before, after].flatMap((r) => r.nodeIds))
      const edgeIds = new Set([fastest, before, after].flatMap((r) => r.edges.map((e) => e.id)))
      if (nodeIds.size > 48 || edgeIds.size > 128 || prepared.length >= 24) { accounting.cappedTrips += flow.trip_count; continue }
      const partitionId = `${id}-od-${flow.origin.station_id}-${flow.destination.station_id}`
      const network = { schemaVersion: 'velocity.simulation-network.v1', coordinateReferenceSystem: 'EPSG:4326', version: `osm-v1-${checksums.osm.slice(0, 12)}`, sourceName: 'OpenStreetMap highway topology enriched with Toronto cycling infrastructure', sourceUrl: 'https://www.openstreetmap.org/copyright', isIllustrative: false, nodes: [...nodeIds].sort(compare).map((id) => localGraph.nodes.get(id)), edges: [...edgeIds].sort(compare).map((id) => localGraph.edges.find((e) => e.id === id)), flows: [{ id: partitionId, from, to, corridorId: id, weight: 1 }], accessibilityMinutes: 15, stressPenalty: 3, maxLowStressDetourRatio: 1.5 }
      if (validateSimulationNetwork(network).length) { accounting.cappedTrips += flow.trip_count; continue }
      prepared.push({ partitionId, tripCount: flow.trip_count, network })
      accounting.retainedTrips += flow.trip_count
    }
    const connectedTrips = accounting.retainedTrips + accounting.cappedTrips, snappedTrips = connectedTrips + accounting.disconnectedTrips
    const coverage = { connectedFraction: snappedTrips ? connectedTrips / snappedTrips : 0, retainedFraction: connectedTrips ? accounting.retainedTrips / connectedTrips : 0, retainedOdPairs: prepared.length }
    if (coverage.connectedFraction < 0.8) errors.push('Connected coverage below 80% of snapped non-self trips')
    if (coverage.retainedFraction < 0.2) errors.push('Route-complete bounded coverage below 20% of connected trips')
    if (coverage.retainedOdPairs < 3) errors.push('Fewer than 3 bounded routable OD pairs')
    const partitions = errors.length ? [] : prepared.map((p) => ({ ...p, network: { ...p.network, flows: p.network.flows.map((f) => ({ ...f, weight: p.tripCount / accounting.retainedTrips })) } }))
    networks.push({ corridorId: id, candidateStatus, status: errors.length ? 'blocked' : 'ready', errors, accounting, coverage, match, partitions })
    const record = records.get(id), alignmentErrors = []
    if (record && JSON.stringify(record.candidate.geometry) !== JSON.stringify(f.geometry)) alignmentErrors.push(`A candidate geometry mismatch or missing geometry: ${id}`)
    if (record && candidateStatus === 'synthetic-fixture' && record.candidate.kind === 'plan-backed') alignmentErrors.push(`A incorrectly claims fixture is plan-backed: ${id}`)
    if (record && JSON.stringify(Object.entries(record.features.normalized).sort()) !== JSON.stringify(Object.entries(inputs).sort())) alignmentErrors.push(`A feature snapshot does not match candidate scores: ${id}`)
    demandErrors.push(...alignmentErrors)
    const blockers = [...errors, ...(!parsed.ok ? parsed.errors : !record ? [`Missing demand record: ${id}`] : alignmentErrors)]
    scenarios.push({ corridorId: id, candidateStatus, status: blockers.length ? 'blocked' : 'precomputed', blockers, simulations: blockers.length ? [] : partitions.map((partition) => ({ partitionId: partition.partitionId, simulation: simulateDemandNetwork(corridor, parsed.artifact, partition.network, { horizonYear: 1, activeCorridorIds: [id] }) })) })
  }
  const portfolio = generatePortfolioRollout(portfolioCandidates)
  if (demandErrors.length) for (const scenario of scenarios) {
    scenario.status = 'blocked'
    scenario.blockers = [...new Set([...scenario.blockers, ...demandErrors])]
    scenario.simulations = []
  }
  for (const scenario of scenarios) for (const item of scenario.simulations) {
    const year = portfolio.years.find((y) => y.builtCorridorIds.includes(scenario.corridorId))
    item.simulation.networkState = { horizonYear: year.horizonYear, activeCorridorIds: [scenario.corridorId] }
    item.simulation.warnings.unshift(`Candidate status: ${scenario.candidateStatus}. Geometry is not a verified construction scope. Population and destination metrics are unavailable. Results cover only retained OD partitions.`)
  }
  return { schemaVersion: 'velocity.b-precompute.v2', coordinateReferenceSystem: 'EPSG:4326', dataStatus: 'osm-routing-analysis', checksums, source: { name: source.title, url: source.download_url, osm: 'https://www.openstreetmap.org/copyright', osmSnapshot: osm.osm3s.timestamp_osm_base }, graph: { nodes: graph.nodes.size, edges: graph.edges.length, exclusions: graph.exclusions, stressEvidence: graph.evidence }, observationPeriod: flows.period, assumptions, demandStatus: demandErrors.length ? 'blocked' : 'validated', demandErrors, networks, portfolio: { dataStatus: 'unverified-candidate-scores', ...portfolio }, scenarios }
}

export async function validateBundle(bundle, root = process.cwd(), verifySources = false) {
  const schema = JSON.parse(await readFile(path.join(root, 'data/contracts/b-precompute.schema.json'), 'utf8'))
  const validate = new Ajv({ allErrors: true }).compile(schema)
  if (!validate(bundle)) throw Error(JSON.stringify(validate.errors))
  const known = new Set(bundle.networks.map((n) => n.corridorId))
  if (known.size !== bundle.networks.length) throw Error('Duplicate candidate networks')
  if ((bundle.demandStatus === 'validated') !== (bundle.demandErrors.length === 0)) throw Error('Inconsistent demand validation state')
  for (const item of bundle.networks) {
    if (item.status === 'ready' && (item.errors.length || !item.partitions.length) || item.status === 'blocked' && (!item.errors.length || item.partitions.length)) throw Error('Invalid readiness state')
    let sum = 0
    if (new Set(item.partitions.map((p) => p.partitionId)).size !== item.partitions.length) throw Error('Duplicate partitions')
    for (const p of item.partitions) {
      const errors = validateSimulationNetwork(p.network)
      if (errors.length) throw Error(errors.join('; '))
      const g = { nodes: new Map(p.network.nodes.map((n) => [n.id, n])), edges: p.network.edges }
      for (const flow of p.network.flows) {
        if (flow.corridorId !== item.corridorId || !route(g, flow.from, flow.to)) throw Error('Disconnected or misassigned exported OD')
        sum += flow.weight
      }
    }
    if (item.status === 'ready' && Math.abs(sum - 1) > 1e-9) throw Error('OD allocation not normalized')
    const a = item.accounting
    if (a.publishedTrips !== a.outsideWindowTrips + a.sameNodeTrips + a.disconnectedTrips + a.cappedTrips + a.retainedTrips) throw Error('OD accounting does not conserve published counts')
    const connected = a.retainedTrips + a.cappedTrips
    const connectivity = connected + a.disconnectedTrips ? connected / (connected + a.disconnectedTrips) : 0
    const retained = connected ? a.retainedTrips / connected : 0
    if (item.coverage.connectedFraction !== connectivity || item.coverage.retainedFraction !== retained) throw Error('Coverage accounting mismatch')
    if (item.status === 'ready' && (item.coverage.retainedOdPairs !== item.partitions.length || item.partitions.reduce((s, p) => s + p.tripCount, 0) !== a.retainedTrips)) throw Error('Partition count accounting mismatch')
    if (item.status === 'ready' && !item.match) throw Error('Missing candidate path')
    if (item.status === 'ready' && (item.coverage.connectedFraction < 0.8 || item.coverage.retainedFraction < 0.2 || item.coverage.retainedOdPairs < 3)) throw Error('Readiness threshold violated')
  }
  const active = new Set()
  for (const [index, year] of bundle.portfolio.years.entries()) {
    if (year.horizonYear !== index + 1) throw Error('Invalid portfolio year')
    for (const id of year.builtCorridorIds) { if (!known.has(id) || active.has(id)) throw Error('Unknown or repeated portfolio build'); active.add(id) }
    if (JSON.stringify([...active].sort(compare)) !== JSON.stringify([...year.activeCorridorIds].sort(compare))) throw Error('Noncumulative portfolio')
  }
  if (bundle.portfolio.rankedCorridorIds.length !== known.size || bundle.portfolio.rankedCorridorIds.some((id) => !known.has(id))) throw Error('Unknown portfolio ranking')
  if (bundle.portfolio.unbuiltCorridorIds.some((id) => !known.has(id) || active.has(id))) throw Error('Invalid unbuilt portfolio IDs')
  if (bundle.scenarios.length !== known.size || new Set(bundle.scenarios.map((s) => s.corridorId)).size !== known.size) throw Error('Scenario candidate coverage mismatch')
  for (const scenario of bundle.scenarios) {
    const network = bundle.networks.find((n) => n.corridorId === scenario.corridorId)
    if (!network) throw Error('Unknown scenario candidate')
    if (scenario.status === 'precomputed' && (bundle.demandStatus !== 'validated' || network.status !== 'ready' || scenario.blockers.length || scenario.simulations.length !== network.partitions.length)) throw Error('Invalid scenario readiness')
    for (const item of scenario.simulations) {
      if (!network.partitions.some((p) => p.partitionId === item.partitionId)) throw Error('Unknown scenario partition')
      if (!item.simulation.routes.every((r) => r.before && r.after)) throw Error('Scenario has disconnected routes')
    }
  }
  if (verifySources) {
    for (const [key, relative] of Object.entries(INPUT_FILES)) if (digest(await readFile(path.join(root, relative))) !== bundle.checksums[key]) throw Error(`Source checksum mismatch: ${relative}`)
    if (bundle.checksums.demand && (!bundle.checksums.demandPath || digest(await readFile(path.resolve(root, bundle.checksums.demandPath))) !== bundle.checksums.demand)) throw Error('Demand checksum mismatch')
  }
}

async function main() {
  const output = 'public/data/b-precomputed.json'
  if (process.argv.includes('--validate')) { await validateBundle(JSON.parse(await readFile(output, 'utf8')), process.cwd(), true); console.log('B schema, routing, readiness, portfolio, OD accounting and source checksums validated.'); return }
  const bytes = Object.fromEntries(await Promise.all(Object.entries(INPUT_FILES).map(async ([key, file]) => [key, await readFile(file)])))
  const registry = JSON.parse(await readFile('data/source-registry.json', 'utf8'))
  const demandPath = process.argv.find((a) => a.startsWith('--demand='))?.slice(9) ?? 'public/data/corridor-demand.json'
  let demand, demandBytes
  try { demandBytes = await readFile(demandPath); demand = JSON.parse(demandBytes) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const result = prepareB({ raw: JSON.parse(bytes.network), osm: JSON.parse(bytes.osm), flows: JSON.parse(bytes.flows), candidates: JSON.parse(bytes.candidates), source: registry.sources.find((s) => s.id === 'cycling-network'), checksums: { ...Object.fromEntries(Object.entries(bytes).map(([k, b]) => [k, digest(b)])), ...(demandBytes ? { demand: digest(demandBytes), demandPath } : {}) }, demand })
  await validateBundle(result)
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
  console.log(`B: ${result.graph.nodes} OSM nodes, ${result.graph.edges} edges. Demand ${result.demandStatus}. A handoff: public/data/corridor-demand.json; rerun b:prepare when A lands.`)
  for (const n of result.networks) console.log(`${n.corridorId}: ${n.status}; ${n.partitions.length} complete route partitions; connected ${(n.coverage.connectedFraction * 100).toFixed(1)}%, retained ${(n.coverage.retainedFraction * 100).toFixed(1)}%. ${n.errors.join('; ')}`)
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
