import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { createHash } from 'node:crypto'

const root = process.cwd()
const load = async (file) => JSON.parse(await readFile(path.join(root, file), 'utf8'))
const manifest = await load('data/processed/training-manifest.json')
const config = await load('data/training-config.json')
const contract = await load('data/contracts/corridor-demand.v2.schema.json')
const fixture = await load('data/fixtures/corridor-demand.v2.example.json')
const csv = await readFile(path.join(root, 'data/processed/counter-training.csv'), 'utf8')
const failures = []
if (createHash('sha256').update(csv).digest('hex') !== manifest.trainingDataSha256) failures.push('Training CSV changed since preparation')
for (const [file, hash] of Object.entries(manifest.inputFileHashes ?? {})) {
  if (createHash('sha256').update(await readFile(path.join(root, file))).digest('hex') !== hash) failures.push(`Stale training input: ${file}; regenerate training data`)
}

const train = new Set(manifest.trainGroupIds ?? [])
const test = new Set(manifest.testGroupIds ?? [])
const overlap = [...train].filter((id) => test.has(id))
if (overlap.length) failures.push(`Train/test counter sites overlap: ${overlap.join(', ')}`)
if (train.size < 2 || test.size < 1) failures.push('Spatial holdout requires at least two train sites and one test site')
if (manifest.grouping !== 'counter-site') failures.push('Training rows must be grouped by counter-site')
if (manifest.normalization?.fittedOn !== 'training-only') failures.push('Normalization must be fitted on training data only')
if (manifest.target !== 'bicycles-per-observed-hour') failures.push('Training label must be bicycles-per-observed-hour')
if (!Number.isInteger(manifest.rowCount) || manifest.rowCount < 1) failures.push('Training data has no rows')
if (csv.trim().split('\n').length - 1 !== manifest.rowCount) failures.push('Training CSV row count does not match its manifest')

const requiredHeaders = ['group_id', 'bicycles_per_observed_hour', ...config.rawFeatureColumns]
const headers = csv.slice(0, csv.indexOf('\n')).split(',').map((header) => header.trim())
for (const header of requiredHeaders) if (!headers.includes(header)) failures.push(`Missing training column: ${header}`)

if (contract.properties?.schemaVersion?.const !== 'velocity.corridor-demand.v2') failures.push('Demand schema version changed')
if (fixture.schemaVersion !== 'velocity.corridor-demand.v2') failures.push('Demand fixture schema version mismatch')
if (fixture.model?.target !== 'relative-bicycles-per-observed-hour') failures.push('Demand fixture target mismatch')
if (fixture.model?.normalization?.fittedOn !== 'training-only') failures.push('Demand fixture leaks normalization data')
if (fixture.model?.productionEligible !== false) failures.push('Untrained contract fixture must not be production eligible')
const forbidden = ['before', 'after', 'routes', 'agents', 'rollout', 'accessibilityUplift', 'safetyBenefits']
for (const [index, record] of (fixture.records ?? []).entries()) {
  for (const key of forbidden) if (key in record) failures.push(`records[${index}] contains Member B field: ${key}`)
  const uncertainty = record.prediction?.uncertainty
  if (uncertainty && uncertainty.lower > uncertainty.upper) failures.push(`records[${index}] uncertainty bounds are reversed`)
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'))
  process.exit(1)
}
console.log(`Pre-training gate passed: ${manifest.rowCount} rows, ${train.size} train sites, ${test.size} held-out sites, v2 evidence-only contract.`)
