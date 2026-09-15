import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import process from 'node:process'
import { gzipSync } from 'node:zlib'
import { digest } from './prepare-b.mjs'

const snapshotDir = 'data/b-source/v1'
await mkdir(snapshotDir, { recursive: true })

const registry = JSON.parse(await readFile('data/source-registry.json', 'utf8'))
const source = registry.sources.find((s) => s.id === 'cycling-network')
if (!source) throw Error('Cycling network source missing from registry')
const response = await fetch(source.download_url, { signal: AbortSignal.timeout(120000) })
if (!response.ok) throw Error(`Cycling network HTTP ${response.status}`)
const bytes = Buffer.from(await response.arrayBuffer())
if (bytes.length > 50000000) throw Error('Cycling network exceeds 50 MB limit')
const raw = JSON.parse(bytes)
if (raw.type !== 'FeatureCollection' || !raw.features?.length) throw Error('Invalid cycling network response')
const cyclingGzip = gzipSync(bytes, { level: 9, mtime: 0 })
await writeFile(`${snapshotDir}/cycling-network.geojson.gz.part`, cyclingGzip)
await rename(`${snapshotDir}/cycling-network.geojson.gz.part`, `${snapshotDir}/cycling-network.geojson.gz`)
process.stdout.write(`Fetched ${raw.features.length} Toronto cycling features; sha256 ${digest(bytes)}\n`)

// Query only cells touched by a 400m candidate buffer. This avoids rectangular
// envelopes that pull large unrelated areas for long or diagonal corridors.
const candidatePath = 'public/data/candidate-catalogue.geojson'
const candidates = JSON.parse(await readFile(candidatePath, 'utf8'))
const tiles = new Map()
const tileScale = 50
const padding = 0.004
const addPoint = ([longitude, latitude]) => {
  for (const dx of [-padding, 0, padding]) for (const dy of [-padding, 0, padding]) {
    const x = Math.floor((longitude + dx) * tileScale), y = Math.floor((latitude + dy) * tileScale)
    tiles.set(`${x}:${y}`, [y / tileScale, x / tileScale, (y + 1) / tileScale, (x + 1) / tileScale])
  }
}
for (const candidate of candidates.features) {
  const lines = candidate.geometry.type === 'LineString' ? [candidate.geometry.coordinates] : candidate.geometry.coordinates
  for (const line of lines) for (let index = 1; index < line.length; index++) {
    const start = line[index - 1], end = line[index]
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1])) / 0.005))
    for (let step = 0; step <= steps; step++) addPoint([start[0] + (end[0] - start[0]) * step / steps, start[1] + (end[1] - start[1]) * step / steps])
  }
}
const fetchedAt = new Date().toISOString()
const tileCacheDir = 'data/raw/b-osm-tiles-v2'
await mkdir(tileCacheDir, { recursive: true })
const query = `[out:json][timeout:240][maxsize:536870912];(${[...tiles.values()].sort((a, b) => a.join(',').localeCompare(b.join(','))).map((bbox) => `way["highway"](${bbox.join(',')});`).join('')});(._;>;);out body;`
const querySha256 = digest(query), cachePath = `${tileCacheDir}/overpass-${querySha256}.json`
let overpassBytes, endpoint
try { overpassBytes = await readFile(cachePath); endpoint = 'cache' } catch (error) { if (error.code !== 'ENOENT') throw error }
for (const url of ['https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter']) {
  if (overpassBytes) break
  const response = await fetch(url, { method: 'POST', headers: { 'User-Agent': 'VeloCity/0.1 (https://github.com/wajeeh-alam/VeloCity; cycling analysis research)', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(300000) })
  if (!response.ok) continue
  overpassBytes = Buffer.from(await response.arrayBuffer())
  endpoint = url
  await writeFile(cachePath, overpassBytes)
}
if (!overpassBytes) throw Error('OSM acquisition blocked on all configured Overpass endpoints. No ready artifact may be published.')
const overpass = JSON.parse(overpassBytes)
const ways = overpass.elements.filter((element) => element.type === 'way' && element.tags?.highway)
const nodeIds = new Set(ways.flatMap((way) => way.nodes))
const elements = [...ways, ...overpass.elements.filter((element) => element.type === 'node' && nodeIds.has(element.id))]
  .sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id)
const downloads = [{ url: endpoint, querySha256, tileCount: tiles.size, sha256: digest(overpassBytes), bytes: overpassBytes.length }]
process.stdout.write(`Fetched ${ways.length} OSM highway ways across ${tiles.size} corridor-following cells.\n`)
const osmBytes = Buffer.from(`${JSON.stringify({ version: '0.6', source: 'OpenStreetMap Overpass candidate-local corridor cells; highway-way and referenced-node extraction', fetchedAt, osm3s: { timestamp_osm_base: fetchedAt }, candidatesSha256: digest(await readFile(candidatePath)), downloads, elements })}\n`)
const osmGzip = gzipSync(osmBytes, { level: 9, mtime: 0 })
await writeFile(`${snapshotDir}/b-osm-network.json.gz.part`, osmGzip)
await rename(`${snapshotDir}/b-osm-network.json.gz.part`, `${snapshotDir}/b-osm-network.json.gz`)
const manifest = {
  schemaVersion: 'velocity.b-source.v1',
  generatedAt: fetchedAt,
  scope: 'Candidate-local extracts sufficient to regenerate public/data/b-precomputed.json; not broad regional downloads.',
  provenance: [
    { role: 'network', title: source.title, url: source.download_url, license: 'Open Government Licence – Toronto' },
    { role: 'osm', title: 'OpenStreetMap Overpass candidate-local extract', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL-1.0', snapshot: fetchedAt },
  ],
  files: [
    { role: 'network', path: `${snapshotDir}/cycling-network.geojson.gz`, sha256: digest(cyclingGzip), bytes: cyclingGzip.length, uncompressedSha256: digest(bytes), uncompressedBytes: bytes.length },
    { role: 'osm', path: `${snapshotDir}/b-osm-network.json.gz`, sha256: digest(osmGzip), bytes: osmGzip.length, uncompressedSha256: digest(osmBytes), uncompressedBytes: osmBytes.length },
  ],
}
await writeFile(`${snapshotDir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)
process.stdout.write(`Pinned B source snapshot saved under ${snapshotDir}; rerun b:prepare before committing refreshed inputs.\n`)
