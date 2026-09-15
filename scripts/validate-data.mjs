import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const scoreKeys = [
  'safety', 'connectivity', 'equity_population', 'current_demand',
  'potential_demand', 'transit', 'barriers', 'coverage', 'destinations',
]
const coreKeys = ['safety', 'connectivity', 'potential_demand']
const failures = []

const load = async (file) => JSON.parse(await readFile(path.join(process.cwd(), 'public/data', file), 'utf8'))
const corridors = await load('corridors.geojson')
const flows = await load('flows.json')
const metrics = await load('model-metrics.json')
const manifest = await load('data-manifest.json')

if (corridors.type !== 'FeatureCollection' || !Array.isArray(corridors.features)) {
  failures.push('corridors.geojson must be a GeoJSON FeatureCollection')
}

for (const feature of corridors.features ?? []) {
  const label = feature.properties?.corridor_id ?? feature.id ?? 'unknown corridor'
  const scores = feature.properties?.scores ?? {}
  for (const key of scoreKeys) {
    if (!Number.isFinite(scores[key]) || scores[key] < 0 || scores[key] > 100) {
      failures.push(`${label}: ${key} must be between 0 and 100`)
    }
  }
  if (failures.length) continue
  const values = scoreKeys.map((key) => scores[key])
  const strong = values.filter((value) => value >= 60).length
  const mean = Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
  const coreWeakness = coreKeys.some((key) => scores[key] < 40)
  const rating = strong >= 8 && !coreWeakness ? 'Top' : strong >= 6 ? 'High' : strong >= 4 ? 'Medium' : 'Low'
  if (feature.properties.strong_input_count !== strong) failures.push(`${label}: strong_input_count should be ${strong}`)
  if (feature.properties.mean_score !== mean) failures.push(`${label}: mean_score should be ${mean}`)
  if (feature.properties.core_weakness !== coreWeakness) failures.push(`${label}: core_weakness should be ${coreWeakness}`)
  if (feature.properties.rating !== rating) failures.push(`${label}: rating should be ${rating}`)
}

if (metrics.schema_version !== '1.0.0') failures.push('model-metrics.json schema_version must be 1.0.0')
if (flows.schema_version !== '1.0.0' || flows.data_status !== 'observed' || !Array.isArray(flows.flows)) {
  failures.push('flows.json must contain observed v1 flows')
}
for (const flow of flows.flows ?? []) {
  if (!flow.origin?.station_id || !flow.destination?.station_id || flow.trip_count < 1) {
    failures.push('flows.json contains an invalid OD flow')
    break
  }
}
if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) failures.push('data-manifest.json must list sources')

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'))
  process.exit(1)
}
console.log(`Validated ${corridors.features.length} corridor(s), ${flows.flows.length} OD flow(s), model metrics, and data manifest.`)
