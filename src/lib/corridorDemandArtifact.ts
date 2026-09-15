import { SCORE_KEYS, type ScoreInputs } from './corridorScoring.ts'

/** Canonical A→B contract. v1's precomputed simulation records are deprecated. */
export const DEMAND_ARTIFACT_SCHEMA_VERSION = 'velocity.corridor-demand.v2' as const
export const DEMAND_TARGET = 'relative-bicycles-per-observed-hour' as const

export type DemandFeatureSnapshot = {
  version: string
  raw: Record<string, number>
  normalized: ScoreInputs
  /** FNV-1a over canonicalFeatureSnapshot(), UTF-8 bytes; integrity, not security. */
  hash: string
}
export type DemandPrediction = {
  corridorId: string
  prediction: number
  uncertainty: { lower: number; upper: number; coverage: number }
  features: DemandFeatureSnapshot
  observedDemandProvenance: {
    kind: 'counter-observation' | 'bike-share-od' | 'multiple-observed-sources'
    sourceName: string
    sourceUrls: string[]
    observationStart: string
    observationEnd: string
    observedHours: number
  }
  candidate?: {
    kind: 'plan-backed' | 'exploratory'
    sourceName: string
    sourceUrl: string
    geometry?: { type: 'LineString'; coordinates: [number, number][] }
  }
}
export type CorridorDemandArtifact = {
  schemaVersion: typeof DEMAND_ARTIFACT_SCHEMA_VERSION
  artifactId: string
  generatedAt: string
  model: {
    id: string
    version: string
    trainedAt: string
    datasetManifestVersion: string
    featureVersion: string
    target: typeof DEMAND_TARGET
    unit: 'dimensionless-relative-hourly-demand'
    /** Label = observed bicycles / valid observed hours / training-only reference. */
    normalization: { referenceBicyclesPerHour: number; fittedOn: 'training-only' }
    productionEligible: boolean
    validation: {
      strategy: 'spatial-holdout'
      grouping: 'counter-site' | 'corridor'
      metric: 'mae' | 'rmse'
      modelValue: number
      medianBaselineValue: number
      baseline: 'training-median'
      lowerIsBetter: true
      trainGroupIds: string[]
      testGroupIds: string[]
    }
  }
  records: DemandPrediction[]
}

/** Stable cross-language serialization: sorted [key,value] arrays and no whitespace. */
export function canonicalFeatureSnapshot(snapshot: Omit<DemandFeatureSnapshot, 'hash'>): string {
  const sorted = (values: Record<string, number>) => Object.keys(values).sort().map((key) => [key, values[key]])
  return JSON.stringify([snapshot.version, sorted(snapshot.raw), sorted(snapshot.normalized)])
}
export function hashFeatureSnapshot(snapshot: Omit<DemandFeatureSnapshot, 'hash'>): string {
  let hash = 2166136261
  for (const byte of new TextEncoder().encode(canonicalFeatureSnapshot(snapshot))) {
    hash = Math.imul(hash ^ byte, 16777619) >>> 0
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`
}

type Obj = Record<string, unknown>
const object = (value: unknown): value is Obj => !!value && typeof value === 'object' && !Array.isArray(value)
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && value.length > 0
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const id = (value: unknown): value is string => nonempty(value) && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value)
function date(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/.test(value)) return false
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value.slice(0, 10)
}
function url(value: unknown): boolean {
  if (!nonempty(value)) return false
  try { return ['https:', 'http:'].includes(new URL(value).protocol) } catch { return false }
}
function keys(value: Obj, allowed: string[], errors: string[], path: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${path}.${key} is not part of the demand contract`)
}

/** Validates JSON and production eligibility; no producer flag bypasses the baseline gate. */
export function parseCorridorDemandArtifact(value: unknown):
  | { ok: true; artifact: CorridorDemandArtifact }
  | { ok: false; errors: string[] } {
  const errors: string[] = []
  const check = (condition: unknown, message: string) => { if (!condition) errors.push(message) }
  if (!object(value)) return { ok: false, errors: ['Demand artifact must be an object'] }
  keys(value, ['schemaVersion', 'artifactId', 'generatedAt', 'model', 'records'], errors, 'artifact')
  check(value.schemaVersion === DEMAND_ARTIFACT_SCHEMA_VERSION, 'Unsupported demand schemaVersion')
  check(id(value.artifactId), 'Invalid artifactId')
  check(date(value.generatedAt), 'generatedAt must be a valid ISO date or UTC timestamp')
  const model = object(value.model) ? value.model : {}
  keys(model, ['id', 'version', 'trainedAt', 'datasetManifestVersion', 'featureVersion', 'target', 'unit', 'normalization', 'productionEligible', 'validation'], errors, 'model')
  for (const key of ['id', 'version', 'datasetManifestVersion', 'featureVersion']) check(nonempty(model[key]), `model.${key} is required`)
  check(date(model.trainedAt), 'Invalid trainedAt')
  check(date(model.trainedAt) && date(value.generatedAt) && Date.parse(model.trainedAt) <= Date.parse(value.generatedAt), 'trainedAt must precede generatedAt')
  check(model.target === DEMAND_TARGET, 'Invalid prediction target')
  check(model.unit === 'dimensionless-relative-hourly-demand', 'Invalid demand unit')
  const normalization = object(model.normalization) ? model.normalization : {}
  keys(normalization, ['referenceBicyclesPerHour', 'fittedOn'], errors, 'normalization')
  check(finite(normalization.referenceBicyclesPerHour) && normalization.referenceBicyclesPerHour > 0 && normalization.fittedOn === 'training-only', 'Normalization must have a positive training-only hourly reference')
  const validation = object(model.validation) ? model.validation : {}
  keys(validation, ['strategy', 'grouping', 'metric', 'modelValue', 'medianBaselineValue', 'baseline', 'lowerIsBetter', 'trainGroupIds', 'testGroupIds'], errors, 'validation')
  check(validation.strategy === 'spatial-holdout' && ['counter-site', 'corridor'].includes(String(validation.grouping)), 'Spatial holdout by counter site or corridor is required')
  check(['mae', 'rmse'].includes(String(validation.metric)) && validation.lowerIsBetter === true && validation.baseline === 'training-median', 'Validation must compare against the training median')
  check(model.productionEligible === true && finite(validation.modelValue) && finite(validation.medianBaselineValue) && validation.modelValue < validation.medianBaselineValue, 'Model must beat the spatial median baseline and be production eligible')
  const groups = (input: unknown): input is string[] => Array.isArray(input) && input.length > 0 && input.every(id) && new Set(input).size === input.length
  check(groups(validation.trainGroupIds) && groups(validation.testGroupIds), 'Nonempty unique train/test group IDs are required')
  if (groups(validation.trainGroupIds) && groups(validation.testGroupIds)) {
    check(!validation.testGroupIds.some((group) => (validation.trainGroupIds as string[]).includes(group)), 'Train/test spatial groups overlap')
  }
  check(Array.isArray(value.records) && value.records.length > 0, 'Prediction records must be nonempty')
  const seen = new Set<string>()
  for (const [index, record] of (Array.isArray(value.records) ? value.records : []).entries()) {
    const path = `records[${index}]`
    if (!object(record)) { errors.push(`${path} must be an object`); continue }
    keys(record, ['corridorId', 'prediction', 'uncertainty', 'features', 'observedDemandProvenance', 'candidate'], errors, path)
    check(id(record.corridorId) && !seen.has(record.corridorId), `${path} requires a unique stable corridorId`)
    if (typeof record.corridorId === 'string') seen.add(record.corridorId)
    check(finite(record.prediction), `${path}.prediction must be finite and nonnegative`)
    const interval = object(record.uncertainty) ? record.uncertainty : {}
    keys(interval, ['lower', 'upper', 'coverage'], errors, `${path}.uncertainty`)
    check(finite(interval.lower) && finite(interval.upper) && finite(record.prediction) && interval.lower <= record.prediction && record.prediction <= interval.upper && finite(interval.coverage) && interval.coverage > 0 && interval.coverage < 1, `${path} has an invalid uncertainty interval`)
    const features = object(record.features) ? record.features : {}
    keys(features, ['version', 'raw', 'normalized', 'hash'], errors, `${path}.features`)
    const raw = features.raw
    const normalized = features.normalized
    const validFeatures = nonempty(features.version) && features.version === model.featureVersion && object(raw) && Object.keys(raw).length > 0 && Object.values(raw).every((n) => typeof n === 'number' && Number.isFinite(n)) && object(normalized) && Object.keys(normalized).length === SCORE_KEYS.length && SCORE_KEYS.every((key) => finite(normalized[key]) && normalized[key] <= 100)
    check(validFeatures, `${path} has an invalid feature snapshot/version`)
    if (validFeatures) check(features.hash === hashFeatureSnapshot(features as DemandFeatureSnapshot), `${path} feature hash mismatch`)
    const provenance = object(record.observedDemandProvenance) ? record.observedDemandProvenance : {}
    keys(provenance, ['kind', 'sourceName', 'sourceUrls', 'observationStart', 'observationEnd', 'observedHours'], errors, `${path}.observedDemandProvenance`)
    check(['counter-observation', 'bike-share-od', 'multiple-observed-sources'].includes(String(provenance.kind)) && nonempty(provenance.sourceName) && Array.isArray(provenance.sourceUrls) && provenance.sourceUrls.length > 0 && provenance.sourceUrls.every(url), `${path} requires observed source provenance`)
    check(finite(provenance.observedHours) && provenance.observedHours > 0, `${path} requires valid observed hours`)
    check(date(provenance.observationStart) && date(provenance.observationEnd) && Date.parse(provenance.observationStart) <= Date.parse(provenance.observationEnd) && date(value.generatedAt) && Date.parse(provenance.observationEnd) <= Date.parse(value.generatedAt), `${path} has invalid observation dates`)
    if (record.candidate !== undefined) {
      const candidate = object(record.candidate) ? record.candidate : {}
      keys(candidate, ['kind', 'sourceName', 'sourceUrl', 'geometry'], errors, `${path}.candidate`)
      check(['plan-backed', 'exploratory'].includes(String(candidate.kind)) && nonempty(candidate.sourceName) && url(candidate.sourceUrl), `${path} has invalid candidate provenance`)
      if (candidate.geometry !== undefined) {
        const geometry = object(candidate.geometry) ? candidate.geometry : {}
        keys(geometry, ['type', 'coordinates'], errors, `${path}.candidate.geometry`)
        check(geometry.type === 'LineString' && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2 && geometry.coordinates.every((point) => Array.isArray(point) && point.length === 2 && point.every((n) => typeof n === 'number' && Number.isFinite(n)) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90), `${path} geometry must be a WGS84 LineString`)
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, artifact: value as CorridorDemandArtifact }
}
