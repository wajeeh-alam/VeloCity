import type { CorridorDemandArtifact } from './corridorDemandArtifact.ts'
import type { Corridor, CorridorSimulation, PortfolioNetworkState, SimulatedAgent, SimulationMetrics } from './corridorDomain.ts'
import { SIMULATION_METRIC_DEFINITIONS } from './corridorDomain.ts'
import { evaluateScore } from './corridorScoring.ts'
import { INPUT_LIMITS, boundedJsonError, addValidationError } from './corridorInputLimits.ts'

export type NetworkNode = {
  id: string
  longitude: number
  latitude: number
  /** Optional SVG-only display projection; never interpreted as geography. */
  x?: number
  y?: number
  population: number
  destinations: number
}
export type NetworkEdge = {
  id: string
  from: string
  to: string
  minutes: number
  highStress: boolean
  /** Building this corridor converts this edge to low stress; edges are bidirectional. */
  corridorId?: string
}
export type DemandFlow = {
  id: string
  from: string
  to: string
  corridorId: string
  /** Relative OD allocation weight, never a daily trip count. */
  weight: number
}
/** B-owned routing inputs, with explicit provenance and analysis assumptions. */
export type SimulationNetwork = {
  schemaVersion: 'velocity.simulation-network.v1'
  coordinateReferenceSystem: 'EPSG:4326'
  version: string
  sourceName: string
  sourceUrl: string
  isIllustrative?: boolean
  nodes: NetworkNode[]
  edges: NetworkEdge[]
  flows: DemandFlow[]
  accessibilityMinutes: number
  stressPenalty: number
  /** Safe-route minutes may not exceed fastest-route minutes times this ratio. */
  maxLowStressDetourRatio: number
}
export type ScenarioRoute = {
  flowId: string
  weight: number
  before: RouteResult | null
  after: RouteResult | null
}
export type RouteResult = {
  edgeIds: string[]; nodeIds: string[]; minutes: number; highStressEdges: number
  coordinateReferenceSystem: 'EPSG:4326'
  /** Canonical ordered GeoJSON positions [longitude, latitude]; Leaflet uses their reverse. */
  coordinates: [number, number][]
  /** Compatibility-only SVG display path. */
  path: string
}

export function validateSimulationNetwork(network: SimulationNetwork): string[] {
  const errors: string[] = []
  const sizeError = boundedJsonError(network)
  if (sizeError) return [sizeError]
  const error = (message: string) => addValidationError(errors, message)
  const validNumber = (n: number) => Number.isFinite(n) && n >= 0
  if (!network || typeof network !== 'object') return ['Missing B routing network']
  if (network.schemaVersion !== 'velocity.simulation-network.v1' || network.coordinateReferenceSystem !== 'EPSG:4326') error('Network requires schema velocity.simulation-network.v1 and CRS EPSG:4326')
  if (network.isIllustrative !== undefined && typeof network.isIllustrative !== 'boolean') error('Invalid network isIllustrative flag')
  if (!network.version || !network.sourceName || !/^https?:\/\/\S+$/.test(network.sourceUrl)) errors.push('Network version and source provenance are required')
  if (!validNumber(network.accessibilityMinutes) || network.accessibilityMinutes === 0 || !validNumber(network.stressPenalty) || network.stressPenalty < 1) errors.push('Invalid accessibility threshold or stress penalty')
  if (!Array.isArray(network.nodes) || !Array.isArray(network.edges) || !Array.isArray(network.flows)) return [...errors, 'Network nodes, edges and flows must be arrays']
  if (network.nodes.length > INPUT_LIMITS.networkNodes || network.edges.length > INPUT_LIMITS.networkEdges || network.flows.length > INPUT_LIMITS.networkFlows) return ['Network exceeds synchronous browser cardinality limits; precompute or partition the graph']
  if (!validNumber(network.maxLowStressDetourRatio) || network.maxLowStressDetourRatio < 1 || network.maxLowStressDetourRatio > 3) error('Maximum low-stress detour ratio must be between 1 and 3')
  const unique = (ids: string[]) => ids.every((id) => typeof id === 'string' && id.length <= INPUT_LIMITS.idLength && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(id)) && new Set(ids).size === ids.length
  if (!network.nodes.every((node) => !!node && typeof node === 'object') || !network.edges.every((edge) => !!edge && typeof edge === 'object') || !network.flows.every((flow) => !!flow && typeof flow === 'object')) return [...errors, 'Network entries must be objects']
  if (!unique(network.nodes.map((node) => node.id)) || !unique(network.edges.map((edge) => edge.id)) || !unique(network.flows.map((flow) => flow.id))) errors.push('Network IDs must be stable and unique')
  const ids = new Set(network.nodes.map((node) => node.id))
  for (const node of network.nodes) if (!Number.isFinite(node.longitude) || Math.abs(node.longitude) > 180 || !Number.isFinite(node.latitude) || Math.abs(node.latitude) > 90 || (node.x !== undefined && !Number.isFinite(node.x)) || (node.y !== undefined && !Number.isFinite(node.y)) || ![node.population, node.destinations].every((n) => validNumber(n) && Number.isSafeInteger(n))) error(`Invalid node ${node.id}`)
  if (!Number.isSafeInteger(network.nodes.reduce((sum, node) => sum + node.population, 0)) || !Number.isSafeInteger(network.nodes.reduce((sum, node) => sum + node.destinations, 0))) errors.push('Network accessibility totals exceed safe integer precision')
  for (const edge of network.edges) if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to || !validNumber(edge.minutes) || edge.minutes === 0 || typeof edge.highStress !== 'boolean' || (edge.corridorId !== undefined && (typeof edge.corridorId !== 'string' || edge.corridorId.length > INPUT_LIMITS.idLength || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(edge.corridorId)))) error(`Invalid edge ${edge.id}`)
  if (!Number.isFinite(network.edges.reduce((sum, edge) => sum + edge.minutes * network.stressPenalty, 0))) errors.push('Network travel-time costs overflow')
  for (const flow of network.flows) if (!ids.has(flow.from) || !ids.has(flow.to) || flow.from === flow.to || !validNumber(flow.weight) || typeof flow.corridorId !== 'string' || flow.corridorId.length > INPUT_LIMITS.idLength || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(flow.corridorId)) error(`Invalid flow ${flow.id}`)
  const nodes = network.nodes.length
  const destinations = network.nodes.filter((node) => node.destinations > 0).length
  // Conservative bound for this synchronous adapter, including both scenarios and accessibility.
  const work = (6 * network.flows.length + 2 * nodes * destinations) * nodes * (network.edges.length + nodes * Math.log2(Math.max(2, nodes)))
  if (work > INPUT_LIMITS.routingWork) error('Network exceeds synchronous routing work budget; precompute or partition the graph')
  if (!network.nodes.length || !network.edges.length || !network.flows.length) errors.push('Routing network must include nodes, edges and flows')
  return errors.slice(0, INPUT_LIMITS.errors)
}

/** Deterministic Dijkstra for the explicitly bounded synchronous graph adapter. */
function route(network: SimulationNetwork, from: string, to: string, active: Set<string>, lowStressOnly: boolean, travelOnly = false): RouteResult | null {
  const distance = new Map<string, number>([[from, 0]])
  const previous = new Map<string, { node: string; edge: NetworkEdge }>()
  const remaining = new Set(network.nodes.map((node) => node.id))
  const stressed = (edge: NetworkEdge) => edge.highStress && !(edge.corridorId && active.has(edge.corridorId))
  const edges = [...network.edges].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  while (remaining.size) {
    const next = [...remaining].sort((a, b) => (distance.get(a) ?? Infinity) - (distance.get(b) ?? Infinity) || (a < b ? -1 : a > b ? 1 : 0))[0]
    if (!Number.isFinite(distance.get(next))) break
    remaining.delete(next)
    if (next === to) break
    for (const edge of edges) {
      const neighbor = edge.from === next ? edge.to : edge.to === next ? edge.from : undefined
      if (!neighbor || !remaining.has(neighbor) || (lowStressOnly && stressed(edge))) continue
      const candidate = distance.get(next)! + edge.minutes * (!travelOnly && stressed(edge) ? network.stressPenalty : 1)
      if (candidate < (distance.get(neighbor) ?? Infinity)) {
        distance.set(neighbor, candidate)
        previous.set(neighbor, { node: next, edge })
      }
    }
  }
  if (!distance.has(to)) return null
  const nodeIds = [to]
  const routeEdges: NetworkEdge[] = []
  let cursor = to
  while (cursor !== from) {
    const step = previous.get(cursor)
    if (!step) return null
    routeEdges.unshift(step.edge)
    nodeIds.unshift(step.node)
    cursor = step.node
  }
  const nodes = new Map(network.nodes.map((node) => [node.id, node]))
  return {
    coordinateReferenceSystem: 'EPSG:4326',
    coordinates: nodeIds.map((id) => [nodes.get(id)!.longitude, nodes.get(id)!.latitude]),
    nodeIds,
    edgeIds: routeEdges.map((edge) => edge.id),
    minutes: routeEdges.reduce((sum, edge) => sum + edge.minutes, 0),
    highStressEdges: routeEdges.filter(stressed).length,
    path: nodeIds.map((id, index) => `${index ? 'L' : 'M'} ${nodes.get(id)!.x ?? nodes.get(id)!.longitude} ${nodes.get(id)!.y ?? -nodes.get(id)!.latitude}`).join(' '),
  }
}

function safeRoute(network: SimulationNetwork, flow: DemandFlow, active: Set<string>): RouteResult | null {
  const fastest = route(network, flow.from, flow.to, active, false, true)
  if (!fastest) return null
  const preferred = route(network, flow.from, flow.to, active, false)!
  // Penalized shortest path chooses stress/time tradeoffs, subject to a hard detour cap.
  return preferred.minutes <= fastest.minutes * network.maxLowStressDetourRatio ? preferred : fastest
}

function metrics(network: SimulationNetwork, active: Set<string>, routes: ScenarioRoute[], stage: 'before' | 'after'): SimulationMetrics {
  const destinations = network.nodes.filter((node) => node.destinations > 0)
  const reached = new Set<string>()
  let populationConnected = 0
  for (const origin of network.nodes) {
    let accessible = false
    for (const destination of destinations) {
      if (origin.id === destination.id) continue
      const path = route(network, origin.id, destination.id, active, true)
      if (path && path.minutes <= network.accessibilityMinutes) {
        accessible = true
        reached.add(destination.id)
      }
    }
    if (accessible) populationConnected += origin.population
  }
  return {
    lowStressTrips: routes.reduce((sum, item) => sum + (item[stage]?.highStressEdges === 0 ? item.weight : 0), 0),
    populationConnected,
    destinationsReached: destinations.reduce((sum, node) => sum + (reached.has(node.id) ? node.destinations : 0), 0),
    dangerousSegments: network.edges.filter((edge) => edge.highStress && !(edge.corridorId && active.has(edge.corridorId))).length,
  }
}

function agents(routes: ScenarioRoute[]): SimulatedAgent[] {
  return routes.flatMap((item) => {
    if (!item.after || item.weight === 0) return []
    if (item.before && item.before.highStressEdges === item.after.highStressEdges && item.before.edgeIds.length === item.after.edgeIds.length && item.before.edgeIds.every((id, index) => id === item.after!.edgeIds[index])) return []
    // At most eight display agents per OD. Fractional final weight conserves demand.
    const count = Math.min(8, Math.max(1, Math.ceil(item.weight)))
    const each = item.weight / count
    return Array.from({ length: count }, (_, index) => ({
      id: `${item.flowId}-agent-${index + 1}`,
      delay: index * 0.17,
      path: item.after!.path,
      beforePath: item.before?.path,
      afterPath: item.after!.path,
      weight: index === count - 1 ? item.weight - each * (count - 1) : each,
      weightUnit: 'relative-demand-weight' as const,
      semantics: 'representative-rerouted-demand' as const,
    }))
  })
}

/** Caller validates the artifact and network. Before excludes only the selected build. */
export function simulateDemandNetwork(corridor: Corridor, artifact: CorridorDemandArtifact, network: SimulationNetwork, state: PortfolioNetworkState): CorridorSimulation {
  const records = new Map(artifact.records.map((record) => [record.corridorId, record]))
  const prediction = records.get(corridor.id)!
  const afterActive = new Set(state.activeCorridorIds)
  const beforeActive = new Set(afterActive)
  beforeActive.delete(corridor.id)
  const routes: ScenarioRoute[] = [...network.flows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((flow) => ({
    flowId: flow.id,
    weight: flow.weight * records.get(flow.corridorId)!.prediction,
    before: safeRoute(network, flow, beforeActive),
    after: safeRoute(network, flow, afterActive),
  }))
  const warnings = [`Scenario assumptions: bidirectional edges; construction converts tagged edges to low stress without changing travel time. Routes minimize travel time weighted by stress penalty ${network.stressPenalty}, capped at ${network.maxLowStressDetourRatio} times fastest travel time. Accessibility uses a low-stress travel-time threshold. Animated agents represent only changed routes or stress states.`]
  if (network.isIllustrative) warnings.unshift('Synthetic routing network: these network outcomes are illustrative even when demand comes from a trained artifact.')
  if (!afterActive.has(corridor.id)) warnings.push('Corridor is not active in this portfolio state; no build effect was applied.')
  if (routes.some((item) => !item.before || !item.after)) warnings.push('Some OD pairs are disconnected; their demand remains unserved and has no animated agent.')
  if (routes.some((item) => item.after && item.after.highStressEdges > 0)) warnings.push('Some chosen routes retain high-stress edges under the configured travel-time/stress tradeoff and detour cap.')
  return {
    before: metrics(network, beforeActive, routes, 'before'),
    after: metrics(network, afterActive, routes, 'after'),
    routes,
    networkState: { ...state, activeCorridorIds: [...afterActive].sort() },
    networkProvenance: { version: network.version, sourceName: network.sourceName, sourceUrl: network.sourceUrl, coordinateReferenceSystem: network.coordinateReferenceSystem, isIllustrative: network.isIllustrative === true },
    agents: agents(routes),
    scoring: evaluateScore(corridor.inputs),
    mode: 'trained-artifact',
    artifactId: artifact.artifactId,
    demand: { prediction: prediction.prediction, lower: prediction.uncertainty.lower, upper: prediction.uncertainty.upper, unit: 'dimensionless-relative-hourly-demand' },
    metricDefinitions: { ...SIMULATION_METRIC_DEFINITIONS, lowStressTrips: { label: 'Demand allocated to low-stress routes', unit: 'relative-demand-weight', betterDirection: 'higher', integer: false } },
    disclaimer: `${network.isIllustrative ? 'Synthetic routing network. ' : ''}B routing scenario weighted by spatially validated relative hourly demand. Demand is conserved between before and after; these are conditional network accessibility and stress indicators, not absolute trips, causal ridership growth, crash forecasts, or official recommendations. Prediction intervals describe A demand uncertainty only, not scenario effect uncertainty.`,
    warnings,
  }
}
