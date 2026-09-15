import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const scoreKeys = [
  'safety', 'connectivity', 'equity', 'currentDemand',
  'potentialDemand', 'transit', 'barriers', 'coverage', 'destinations',
]
const coreKeys = ['safety', 'connectivity', 'potentialDemand']
const scoreWeights = {
  safety: 0.15,
  connectivity: 0.15,
  equity: 0.10,
  currentDemand: 0.10,
  potentialDemand: 0.15,
  transit: 0.08,
  barriers: 0.10,
  coverage: 0.08,
  destinations: 0.09,
}
const failures = []

const load = async (file) => JSON.parse(await readFile(path.join(process.cwd(), 'public/data', file), 'utf8'))
const scoringSource = await readFile(path.join(process.cwd(), 'src/lib/corridorScoring.ts'), 'utf8')
const artifactSource = await readFile(path.join(process.cwd(), 'src/lib/corridorArtifact.ts'), 'utf8')
const corridors = await load('corridors.geojson')
const flows = await load('flows.json')
const metrics = await load('model-metrics.json')
const manifest = await load('data-manifest.json')

const scoreKeyBlock = scoringSource.match(/export const SCORE_KEYS = \[([\s\S]*?)\] as const/)
const memberBScoreKeys = [...(scoreKeyBlock?.[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1])
if (JSON.stringify(memberBScoreKeys) !== JSON.stringify(scoreKeys)) {
  failures.push(`Member A score keys do not match Member B: ${memberBScoreKeys.join(', ')}`)
}
if (!artifactSource.includes("'velocity.corridor-predictions.v1'")) {
  failures.push('Member B prediction artifact schema version changed')
}
if (!artifactSource.includes("target: 'relative-bicycles-per-observed-hour'")) {
  failures.push('Member B prediction target changed')
}

if (corridors.type !== 'FeatureCollection' || !Array.isArray(corridors.features)) {
  failures.push('corridors.geojson must be a GeoJSON FeatureCollection')
}

for (const feature of corridors.features ?? []) {
  const label = feature.properties?.corridorId ?? feature.id ?? 'unknown corridor'
  const scores = feature.properties?.scores ?? {}
  if (!['plan-backed', 'exploratory'].includes(feature.properties?.candidateType)) {
    failures.push(`${label}: candidateType must match Member B provenance kinds`)
  }
  if (!['fixture', 'observed', 'modelled', 'mixed'].includes(feature.properties?.dataStatus)) {
    failures.push(`${label}: invalid dataStatus`)
  }
  for (const key of scoreKeys) {
    if (!Number.isFinite(scores[key]) || scores[key] < 0 || scores[key] > 100) {
      failures.push(`${label}: ${key} must be between 0 and 100`)
    }
  }
  if (failures.length) continue
  const values = scoreKeys.map((key) => scores[key])
  const strong = values.filter((value) => value >= 60).length
  const mean = Math.round(scoreKeys.reduce((sum, key) => sum + scores[key] * scoreWeights[key], 0) * 10) / 10
  const coreWeakness = coreKeys.some((key) => scores[key] < 40)
  const rating = strong >= 8 && !coreWeakness ? 'Top' : strong >= 6 ? 'High' : strong >= 4 ? 'Medium' : 'Low'
  const coreWeaknesses = coreKeys.filter((key) => scores[key] < 40)
  if (feature.properties.strongInputCount !== strong) failures.push(`${label}: strongInputCount should be ${strong}`)
  if (feature.properties.meanScore !== mean) failures.push(`${label}: meanScore should be ${mean}`)
  if (JSON.stringify(feature.properties.coreWeaknesses) !== JSON.stringify(coreWeaknesses)) failures.push(`${label}: coreWeaknesses should match the canonical core score keys`)
  if (feature.properties.tier !== rating) failures.push(`${label}: tier should be ${rating}`)
  if (feature.properties.rubricVersion !== 'velocity-priority-v1') failures.push(`${label}: rubricVersion must be velocity-priority-v1`)
  if (feature.properties.corridorId !== feature.id) failures.push(`${label}: GeoJSON id and corridorId must match`)
}

if (metrics.schema_version !== '1.0.0') failures.push('model-metrics.json schema_version must be 1.0.0')
if (metrics.target !== 'relative-bicycles-per-observed-hour') failures.push('model target does not match Member B contract')
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
