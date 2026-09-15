import Ajv from 'ajv'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import process from 'node:process'

const readJson = async url => JSON.parse(await readFile(url, 'utf8'))
const schema = await readJson(new URL('../data/contracts/corridor-opportunities.v1.schema.json', import.meta.url))
const validateSchema = new Ajv({ allErrors: true, strict: false }).compile(schema)

export function validateOpportunities(artifact, demand, catalogue) {
  const failures = []
  if (!validateSchema(artifact)) {
    return validateSchema.errors.map(error => `${error.instancePath ?? error.dataPath ?? '/'} ${error.message}`)
  }
  if (artifact.evidenceArtifactId !== demand.artifactId) failures.push('Evidence artifact ID mismatch')
  const demandRecords = new Map(demand.records.map(record => [record.corridorId, record]))
  const candidates = new Map(catalogue.features.map(feature => [feature.id, feature]))
  const ids = new Set()
  const ranks = new Set()
  const portfolioIds = artifact.portfolio.years.flatMap(item => item.corridorIds)
  if (new Set(artifact.portfolio.years.map(item => item.year)).size !== 3) failures.push('Portfolio must contain unique Year 1–3 entries')
  if (new Set(portfolioIds).size !== portfolioIds.length) failures.push('Portfolio corridor IDs overlap across years')

  for (const record of artifact.records) {
    if (ids.has(record.corridorId)) failures.push(`Duplicate corridor ${record.corridorId}`)
    ids.add(record.corridorId)
    if (ranks.has(record.priority.rank)) failures.push(`Duplicate rank ${record.priority.rank}`)
    ranks.add(record.priority.rank)
    const source = demandRecords.get(record.corridorId)
    const candidate = candidates.get(record.corridorId)
    if (!source || !candidate) failures.push(`Unresolved source corridor ${record.corridorId}`)
    if (source && JSON.stringify(record.evidence.inputScores) !== JSON.stringify(source.inputScores)) failures.push(`Evidence scores changed ${record.corridorId}`)
    if (source && JSON.stringify(record.evidence.rawFeatures) !== JSON.stringify(source.rawFeatures)) failures.push(`Raw evidence changed ${record.corridorId}`)
    if (source && JSON.stringify(record.evidence.prediction) !== JSON.stringify(source.prediction)) failures.push(`Prediction changed ${record.corridorId}`)
    if (source && JSON.stringify(record.evidence.observation) !== JSON.stringify(source.observation)) failures.push(`Observation dates changed ${record.corridorId}`)
    if (source && JSON.stringify(record.evidence.sourceProvenance) !== JSON.stringify(source.sourceProvenance)) failures.push(`Provenance changed ${record.corridorId}`)
    if (record.evidence.modelBeatBaseline !== demand.model.productionEligible) failures.push(`Baseline result changed ${record.corridorId}`)
    if (record.evidence.modelValidation.metric !== demand.model.validation.metric || record.evidence.modelValidation.modelValue !== demand.model.validation.modelValue || record.evidence.modelValidation.medianBaselineValue !== demand.model.validation.medianBaselineValue) failures.push(`Validation metrics changed ${record.corridorId}`)
    if (candidate && JSON.stringify(record.geometry) !== JSON.stringify(candidate.geometry)) failures.push(`Candidate geometry changed ${record.corridorId}`)
    const { before, after, deltas, representativeAgents, networkState, routeAlternatives, selectedRouteId } = record.comparison
    for (const key of Object.keys(before)) {
      if (after[key] - before[key] !== deltas[key]) failures.push(`Incorrect ${key} delta ${record.corridorId}`)
    }
    if (after.lowStressTrips < before.lowStressTrips || after.populationConnected < before.populationConnected || after.destinationsReached < before.destinationsReached || after.dangerousSegments > before.dangerousSegments) failures.push(`Invalid comparison direction ${record.corridorId}`)
    if (representativeAgents.reduce((sum, agent) => sum + agent.weight, 0) !== deltas.lowStressTrips) failures.push(`Agent weights do not conserve trip delta ${record.corridorId}`)
    if (representativeAgents.some(agent => [...agent.origin, ...agent.destination].some(value => !Number.isFinite(value) || Math.abs(value) > 180) || agent.afterRouteId !== selectedRouteId)) failures.push(`Invalid representative agent ${record.corridorId}`)
    if (!routeAlternatives.some(route => route.id === selectedRouteId && route.kind === 'official-candidate-alignment' && route.geometryRef === 'record.geometry')) failures.push(`Selected route is not the official candidate ${record.corridorId}`)
    if (networkState.afterActiveCorridorIds.at(-1) !== record.corridorId || JSON.stringify(networkState.afterActiveCorridorIds.slice(0, -1)) !== JSON.stringify(networkState.beforeActiveCorridorIds)) failures.push(`Invalid network transition ${record.corridorId}`)
    const year = artifact.portfolio.years.find(item => item.corridorIds.includes(record.corridorId))?.year
    if (year !== record.priority.rolloutYear || year !== networkState.horizonYear) failures.push(`Rollout year mismatch ${record.corridorId}`)
    if (!record.comparison.warnings.some(item => item.includes('not trained outputs'))) failures.push(`Missing synthetic scenario warning ${record.corridorId}`)
  }
  if (ids.size !== demandRecords.size || portfolioIds.some(id => !ids.has(id))) failures.push('Opportunity, demand and portfolio corridor sets differ')
  if (JSON.stringify([...ranks].sort((a, b) => a - b)) !== JSON.stringify(Array.from({ length: artifact.records.length }, (_, index) => index + 1))) failures.push('Priority ranks must be contiguous')
  if (artifact.records.some(record => record.evidence.status !== 'trained-artifact' || record.comparison.status !== 'synthetic-fallback')) failures.push('Evidence/scenario status labels are not explicit')
  return failures
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const readPublic = file => readJson(new URL(`../public/data/${file}`, import.meta.url))
  const artifact = await readPublic('corridor-opportunities.json')
  const failures = validateOpportunities(
    artifact,
    await readPublic('corridor-demand.json'),
    await readPublic('candidate-catalogue.geojson'),
  )
  if (failures.length) {
    console.error(failures.join('\n'))
    process.exitCode = 1
  } else {
    console.log(`Validated ${artifact.records.length} C-ready opportunity profiles`)
  }
}
