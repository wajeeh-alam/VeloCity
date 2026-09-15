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

// Candidate-local OSM API tiles avoid Overpass availability and map API's 50k-node limit.
const candidates = JSON.parse(await readFile('public/data/corridors.geojson', 'utf8'))
const tiles = new Map()
for (const candidate of candidates.features) {
  const points = candidate.geometry.coordinates
  const west = Math.floor((Math.min(...points.map((p) => p[0])) - 0.004) * 100)
  const east = Math.floor((Math.max(...points.map((p) => p[0])) + 0.004) * 100)
  const south = Math.floor((Math.min(...points.map((p) => p[1])) - 0.004) * 100)
  const north = Math.floor((Math.max(...points.map((p) => p[1])) + 0.004) * 100)
  for (let x = west; x <= east; x++) for (let y = south; y <= north; y++) tiles.set(`${x}:${y}`, [x / 100, y / 100, (x + 1) / 100, (y + 1) / 100])
}
const elements = new Map(), downloads = []
const fetchedAt = new Date().toISOString()
for (const bbox of tiles.values()) {
  const url = `https://api.openstreetmap.org/api/0.6/map.json?bbox=${bbox.join(',')}`
  const response = await fetch(url, { headers: { 'User-Agent': 'VeloCity/0.1 (https://github.com/wajeeh-alam/VeloCity; cycling analysis research)' }, signal: AbortSignal.timeout(45000) })
  if (!response.ok) throw Error(`OSM acquisition blocked: ${response.status} for ${url}. No ready artifact may be published.`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const tile = JSON.parse(bytes)
  const ways = tile.elements.filter((e) => e.type === 'way' && e.tags?.highway)
  const nodeIds = new Set(ways.flatMap((w) => w.nodes))
  for (const e of [...ways, ...tile.elements.filter((e) => e.type === 'node' && nodeIds.has(e.id))]) elements.set(`${e.type}:${e.id}`, e)
  downloads.push({ url, bbox, sha256: digest(bytes), bytes: bytes.length })
  process.stdout.write(`OSM tile ${downloads.length}/${tiles.size}: ${ways.length} highway ways\n`)
}
const osmBytes = Buffer.from(`${JSON.stringify({ version: '0.6', source: 'OpenStreetMap API 0.6 candidate-local tiles; highway-way and referenced-node extraction', fetchedAt, osm3s: { timestamp_osm_base: fetchedAt }, candidatesSha256: digest(await readFile('public/data/corridors.geojson')), downloads, elements: [...elements.values()].sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id) })}\n`)
const osmGzip = gzipSync(osmBytes, { level: 9, mtime: 0 })
await writeFile(`${snapshotDir}/b-osm-network.json.gz.part`, osmGzip)
await rename(`${snapshotDir}/b-osm-network.json.gz.part`, `${snapshotDir}/b-osm-network.json.gz`)
const manifest = {
  schemaVersion: 'velocity.b-source.v1',
  generatedAt: fetchedAt,
  scope: 'Candidate-local extracts sufficient to regenerate public/data/b-precomputed.json; not broad regional downloads.',
  provenance: [
    { role: 'network', title: source.title, url: source.download_url, license: 'Open Government Licence – Toronto' },
    { role: 'osm', title: 'OpenStreetMap API 0.6 candidate-local tiles', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL-1.0', snapshot: fetchedAt },
  ],
  files: [
    { role: 'network', path: `${snapshotDir}/cycling-network.geojson.gz`, sha256: digest(cyclingGzip), bytes: cyclingGzip.length, uncompressedSha256: digest(bytes), uncompressedBytes: bytes.length },
    { role: 'osm', path: `${snapshotDir}/b-osm-network.json.gz`, sha256: digest(osmGzip), bytes: osmGzip.length, uncompressedSha256: digest(osmBytes), uncompressedBytes: osmBytes.length },
  ],
}
await writeFile(`${snapshotDir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)
process.stdout.write(`Pinned B source snapshot saved under ${snapshotDir}; rerun b:prepare before committing refreshed inputs.\n`)
