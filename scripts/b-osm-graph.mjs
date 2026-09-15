export const distance = (a, b) => Math.hypot((a[0] - b[0]) * 80500, (a[1] - b[1]) * 111200)
export const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
export const pointSegmentDistance = (p, a, b) => {
  const dx = (b[0] - a[0]) * 80500, dy = (b[1] - a[1]) * 111200
  const t = Math.max(0, Math.min(1, (((p[0] - a[0]) * 80500 * dx + (p[1] - a[1]) * 111200 * dy) / (dx * dx + dy * dy)) || 0))
  return distance(p, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])])
}
export const coordinate = (n) => [n.longitude, n.latitude]
export const toLine = (p, line) => Math.min(...line.slice(1).map((end, i) => pointSegmentDistance(p, line[i], end)))

/** OSM identities establish connectivity; geometric crossings are never joined. */
export function buildGraph(osm, cycling) {
  if (!osm?.elements?.length || !osm.osm3s?.timestamp_osm_base) throw Error('Missing live OSM snapshot; b:fetch must succeed before preparation')
  const nodes = new Map(osm.elements.filter((e) => e.type === 'node').map((n) => {
    if (!Number.isFinite(n.lon) || !Number.isFinite(n.lat) || Math.abs(n.lon) > 180 || Math.abs(n.lat) > 90) throw Error('Invalid OSM node coordinate')
    return [`osm-n-${n.id}`, { id: `osm-n-${n.id}`, longitude: n.lon, latitude: n.lat, population: 0, destinations: 0 }]
  }))
  const infrastructure = []
  for (const f of cycling.features) {
    const classification = `${f.properties?.INFRA_LOWORDER ?? ''} ${f.properties?.INFRA_HIGHORDER ?? ''}`
    if (!/Cycle Track|Multi-Use Trail|Raised Cycle Track/i.test(classification)) continue
    const lines = f.geometry?.type === 'MultiLineString' ? f.geometry.coordinates : f.geometry?.type === 'LineString' ? [f.geometry.coordinates] : []
    for (const line of lines) for (let i = 1; i < line.length; i++) infrastructure.push([line[i - 1], line[i]])
  }
  const edges = [], exclusions = { forbiddenWays: 0, directionalWays: 0 }, evidence = { osmLowStressEdges: 0, torontoEnrichedEdges: 0, highStressEdges: 0 }
  for (const way of osm.elements.filter((e) => e.type === 'way').sort((a, b) => a.id - b.id)) {
    const t = way.tags ?? {}
    if (!t.highway || ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'construction', 'proposed', 'steps'].includes(t.highway) || ['no', 'private'].includes(t.access) || ['no', 'private', 'use_sidepath'].includes(t.bicycle) || ['footway', 'pedestrian'].includes(t.highway) && !['yes', 'designated'].includes(t.bicycle)) { exclusions.forbiddenWays++; continue }
    // B v1 cannot represent directed edges: omit directional ways instead of permitting illegal reverse travel.
    if ((['yes', '1', '-1'].includes(t.oneway) || t.junction === 'roundabout') && t['oneway:bicycle'] !== 'no' && !Object.entries(t).some(([k, v]) => k.startsWith('cycleway') && /^opposite/.test(v))) { exclusions.directionalWays++; continue }
    const speedKmh = Number.parseFloat(t.maxspeed) * (/mph/i.test(t.maxspeed ?? '') ? 1.609344 : 1)
    const tagLow = t.highway === 'cycleway' || t.highway === 'living_street' || ['path', 'track'].includes(t.highway) && ['yes', 'designated'].includes(t.bicycle) || ['residential', 'service'].includes(t.highway) && (!t.maxspeed || speedKmh <= 40) || Object.entries(t).some(([k, v]) => k.startsWith('cycleway') && ['track', 'opposite_track'].includes(v))
    for (let i = 1; i < way.nodes.length; i++) {
      const from = `osm-n-${way.nodes[i - 1]}`, to = `osm-n-${way.nodes[i]}`
      if (!nodes.has(from) || !nodes.has(to)) throw Error(`OSM way ${way.id} references missing nodes`)
      const a = coordinate(nodes.get(from)), b = coordinate(nodes.get(to)), length = distance(a, b)
      if (from === to || length <= 0) continue
      // Require both endpoints close to the SAME protected infrastructure segment.
      const enriched = !tagLow && infrastructure.some(([c, d]) => pointSegmentDistance(a, c, d) <= 12 && pointSegmentDistance(b, c, d) <= 12)
      const highStress = !tagLow && !enriched
      evidence[tagLow ? 'osmLowStressEdges' : enriched ? 'torontoEnrichedEdges' : 'highStressEdges']++
      edges.push({ id: `osm-w-${way.id}-${i - 1}`, from, to, minutes: length / 250, highStress })
    }
  }
  const used = new Set(edges.flatMap((e) => [e.from, e.to]))
  return { nodes: new Map([...nodes].filter(([id]) => used.has(id))), edges, exclusions, evidence }
}

export function adjacency(graph) {
  const result = new Map([...graph.nodes.keys()].map((id) => [id, []]))
  for (const edge of graph.edges) {
    result.get(edge.from).push({ id: edge.to, edge })
    result.get(edge.to).push({ id: edge.from, edge })
  }
  for (const list of result.values()) list.sort((a, b) => compare(a.edge.id, b.edge.id))
  return result
}

/** Binary heap Dijkstra on the complete build-time graph. */
export function route(graph, from, to, { active = false, penalize = false, allowed } = {}) {
  const neighbors = graph.adjacency ?? adjacency(graph)
  const costs = new Map([[from, 0]]), previous = new Map(), queue = [[0, from]]
  const less = (a, b) => a[0] < b[0] || a[0] === b[0] && compare(a[1], b[1]) < 0
  const push = (value) => {
    queue.push(value)
    let i = queue.length - 1
    while (i > 0) { const p = (i - 1) >> 1; if (!less(queue[i], queue[p])) break; [queue[i], queue[p]] = [queue[p], queue[i]]; i = p }
  }
  const pop = () => {
    const first = queue[0], last = queue.pop()
    if (queue.length) {
      queue[0] = last
      let i = 0
      for (;;) { let n = i; const l = 2 * i + 1, r = l + 1; if (l < queue.length && less(queue[l], queue[n])) n = l; if (r < queue.length && less(queue[r], queue[n])) n = r; if (n === i) break; [queue[i], queue[n]] = [queue[n], queue[i]]; i = n }
    }
    return first
  }
  while (queue.length) {
    const [cost, id] = pop()
    if (cost !== costs.get(id)) continue
    if (id === to) break
    for (const { id: next, edge } of neighbors.get(id) ?? []) {
      if (allowed && !allowed.has(edge.id)) continue
      const candidate = cost + edge.minutes * (penalize && edge.highStress && !(active && edge.corridorId) ? 3 : 1)
      if (candidate < (costs.get(next) ?? Infinity)) { costs.set(next, candidate); previous.set(next, { id, edge }); push([candidate, next]) }
    }
  }
  if (!costs.has(to)) return null
  const nodeIds = [to], edges = []
  let cursor = to
  while (cursor !== from) { const p = previous.get(cursor); if (!p) return null; edges.unshift(p.edge); nodeIds.unshift(p.id); cursor = p.id }
  return { nodeIds, edges, minutes: edges.reduce((s, e) => s + e.minutes, 0) }
}

export function snap(graph, position, maxDistance) {
  let best
  for (const n of graph.nodes.values()) {
    const d = distance(position, coordinate(n))
    if (d <= maxDistance && (!best || d < best.distance || d === best.distance && compare(n.id, best.id) < 0)) best = { id: n.id, distance: d }
  }
  return best
}

export function matchCandidate(graph, coords) {
  const from = snap(graph, coords[0], 150), to = snap(graph, coords.at(-1), 150)
  if (!from || !to || from.id === to.id) return null
  const allowed = new Set(graph.edges.filter((e) => toLine(coordinate(graph.nodes.get(e.from)), coords) <= 300 && toLine(coordinate(graph.nodes.get(e.to)), coords) <= 300).map((e) => e.id))
  const matched = route(graph, from.id, to.id, { allowed })
  const candidateMetres = coords.slice(1).reduce((s, p, i) => s + distance(coords[i], p), 0)
  if (!matched || matched.minutes * 250 > candidateMetres * 1.8) return null
  return { edgeIds: matched.edges.map((e) => e.id), endpointSnapMetres: [from.distance, to.distance], pathMetres: matched.minutes * 250 }
}
