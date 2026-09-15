import Ajv from 'ajv'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import process from 'node:process'

const schema = JSON.parse(await readFile(new URL('../data/contracts/corridor-demand.v2.schema.json', import.meta.url), 'utf8'))
const validateSchema = new Ajv({ allErrors: true, jsonPointers: true }).compile(schema)

export function validateDemand(artifact, manifest, catalogue) {
  const failures = []
  if (!validateSchema(artifact)) {
    return validateSchema.errors.map(error => `${error.dataPath || '/'} ${error.message}`)
  }
  const model = artifact.model
  const validation = model.validation
  if (validation.trainGroupIds.some(id => validation.testGroupIds.includes(id))) failures.push('Train/test groups overlap')
  if (model.productionEligible !== (validation.modelValue < validation.medianBaselineValue)) failures.push('productionEligible disagrees with baseline comparison')
  if (!artifact.records.length) failures.push('Published demand artifact has no corridor records')
  if (artifact.artifactId.includes('example') || model.id.includes('example')) failures.push('Contract fixture cannot be published')
  if (model.datasetManifestVersion !== manifest.version) failures.push('Dataset manifest version mismatch')
  if (artifact.artifactId !== manifest.demandArtifactId) failures.push('Demand artifact ID mismatch')
  const sources = new Set(manifest.sources.map(source => source.id))
  const candidates = new Map(catalogue.features.map(feature => [feature.id, feature]))
  const ids = new Set()
  for (const record of artifact.records) {
    if (ids.has(record.corridorId)) failures.push(`Duplicate corridor ${record.corridorId}`)
    ids.add(record.corridorId)
    const candidate = candidates.get(record.corridorId)
    if (!candidate) failures.push(`Unknown corridor ${record.corridorId}`)
    if (candidate && JSON.stringify(candidate.geometry) !== JSON.stringify(record.geometry)) failures.push(`Geometry mismatch ${record.corridorId}`)
    const { relativeBicyclesPerObservedHour: estimate, uncertainty } = record.prediction
    if (!(uncertainty.lower <= estimate && estimate <= uncertainty.upper)) failures.push(`Uncertainty does not contain prediction ${record.corridorId}`)
    if (record.observation.start > record.observation.end) failures.push('Observation dates reversed')
    if (record.sourceProvenance.some(id => !sources.has(id))) failures.push(`Unresolved source ${record.corridorId}`)
    if (Object.values(record.rawFeatures).some(value => value !== null && !Number.isFinite(value))) failures.push('Nonfinite raw feature')
    const geom = record.geometry
    if (!geom || !['LineString', 'MultiLineString'].includes(geom.type)) {
      failures.push(`Unsupported geometry ${record.corridorId}`)
    } else {
      const lines = geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates
      if (!Array.isArray(lines) || !lines.length || lines.some(line => !Array.isArray(line) || line.length < 2 || line.some(point =>
        !Array.isArray(point) || point.length < 2 || !point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90))) failures.push('Invalid geographic coordinates')
    }
  }
  return failures
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const read = async file => JSON.parse(await readFile(new URL(`../public/data/${file}`, import.meta.url), 'utf8'))
  const artifact = await read('corridor-demand.json')
  const failures = validateDemand(artifact, await read('data-manifest.json'), await read('candidate-catalogue.geojson'))
  if (failures.length) {
    console.error(failures.join('\n'))
    process.exitCode = 1
  } else {
    console.log(`Validated v2 demand artifact: ${artifact.records.length} corridors; productionEligible=${artifact.model.productionEligible}`)
  }
}
