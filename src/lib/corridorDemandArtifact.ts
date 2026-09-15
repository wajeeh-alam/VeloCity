import { SCORE_KEYS, type ScoreInputs } from './corridorScoring.ts'
import { INPUT_LIMITS, boundedJsonError, addValidationError } from './corridorInputLimits.ts'

/** Canonical Member A → Member B demand contract. */
export const DEMAND_ARTIFACT_SCHEMA_VERSION = 'velocity.corridor-demand.v2' as const
export const DEMAND_TARGET = 'relative-bicycles-per-observed-hour' as const

export type DemandGeometry =
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'MultiLineString'; coordinates: [number, number][][] }

export type DemandPrediction = {
  corridorId: string
  geometry?: DemandGeometry | null
  inputScores: ScoreInputs
  rawFeatures: Record<string, number | null>
  prediction: {
    relativeBicyclesPerObservedHour: number
    uncertainty: {
      lower: number
      upper: number
      level: number
      method: 'spatial-holdout-residual-quantile' | 'bootstrap'
    }
  }
  observation: { start: string; end: string }
  sourceProvenance: string[]
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

/** @deprecated Retained only for deterministic feature fingerprints in older consumers. */
export type DemandFeatureSnapshot = { version: string; raw: Record<string, number>; normalized: ScoreInputs; hash: string }
export function canonicalFeatureSnapshot(snapshot: Omit<DemandFeatureSnapshot, 'hash'>): string {
  const sorted = (values: Record<string, number>) => Object.keys(values).sort().map((key) => [key, values[key]])
  return JSON.stringify([snapshot.version, sorted(snapshot.raw), sorted(snapshot.normalized)])
}
export function hashFeatureSnapshot(snapshot: Omit<DemandFeatureSnapshot, 'hash'>): string {
  let hash = 2166136261
  for (const byte of new TextEncoder().encode(canonicalFeatureSnapshot(snapshot))) hash = Math.imul(hash ^ byte, 16777619) >>> 0
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`
}

type Obj = Record<string, unknown>
const object = (value: unknown): value is Obj => !!value && typeof value === 'object' && !Array.isArray(value)
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && value.length > 0
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const validId = (value: unknown): value is string => nonempty(value) && value.length <= INPUT_LIMITS.idLength && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value)
function timestamp(value: unknown): value is string {
  return nonempty(value) && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))
}
function date(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
}
function keys(value: Obj, allowed: string[], errors: string[], path: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) addValidationError(errors, `${path}.${key} is not part of the demand contract`)
}
function validPoint(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every((n) => typeof n === 'number' && Number.isFinite(n)) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90
}
function validGeometry(value: unknown): value is DemandGeometry {
  if (!object(value)) return false
  if (value.type === 'LineString') return Array.isArray(value.coordinates) && value.coordinates.length >= 2 && value.coordinates.length <= INPUT_LIMITS.geometryPoints && value.coordinates.every(validPoint)
  if (value.type === 'MultiLineString' && Array.isArray(value.coordinates) && value.coordinates.length > 0) {
    const lines = value.coordinates
    return lines.reduce((sum, line) => sum + (Array.isArray(line) ? line.length : 0), 0) <= INPUT_LIMITS.geometryPoints && lines.every((line) => Array.isArray(line) && line.length >= 2 && line.every(validPoint))
  }
  return false
}

/** Strict, synchronous production gate for the committed A contract. */
export function parseCorridorDemandArtifact(value: unknown):
  | { ok: true; artifact: CorridorDemandArtifact }
  | { ok: false; errors: string[] } {
  const errors: string[] = []
  const sizeError = boundedJsonError(value)
  if (sizeError) return { ok: false, errors: [sizeError] }
  const check = (condition: unknown, message: string) => { if (!condition) addValidationError(errors, message) }
  if (!object(value)) return { ok: false, errors: ['Demand artifact must be an object'] }
  keys(value, ['schemaVersion', 'artifactId', 'generatedAt', 'model', 'records'], errors, 'artifact')
  check(value.schemaVersion === DEMAND_ARTIFACT_SCHEMA_VERSION, 'Unsupported demand schemaVersion')
  check(validId(value.artifactId), 'Invalid artifactId')
  check(timestamp(value.generatedAt), 'generatedAt must be a valid RFC 3339 timestamp')

  const model = object(value.model) ? value.model : {}
  keys(model, ['id', 'version', 'trainedAt', 'datasetManifestVersion', 'featureVersion', 'target', 'unit', 'normalization', 'productionEligible', 'validation'], errors, 'model')
  for (const key of ['id', 'version', 'datasetManifestVersion', 'featureVersion']) check(nonempty(model[key]), `model.${key} is required`)
  check(timestamp(model.trainedAt), 'model.trainedAt must be a valid RFC 3339 timestamp')
  check(timestamp(model.trainedAt) && timestamp(value.generatedAt) && Date.parse(model.trainedAt) <= Date.parse(value.generatedAt), 'trainedAt must precede generatedAt')
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
  const groups = (input: unknown): input is string[] => Array.isArray(input) && input.length > 0 && input.length <= INPUT_LIMITS.spatialGroups && input.every(validId) && new Set(input).size === input.length
  check(groups(validation.trainGroupIds) && groups(validation.testGroupIds), 'Nonempty unique train/test group IDs are required')
  if (groups(validation.trainGroupIds) && groups(validation.testGroupIds)) {
    const trainGroups = validation.trainGroupIds
    check(!validation.testGroupIds.some((group) => trainGroups.includes(group)), 'Train/test spatial groups overlap')
  }

  check(Array.isArray(value.records) && value.records.length > 0, 'Prediction records must be nonempty')
  if (Array.isArray(value.records) && value.records.length > INPUT_LIMITS.records) return { ok: false, errors: ['Prediction records exceed cardinality limit'] }
  const seen = new Set<string>()
  for (const [index, record] of (Array.isArray(value.records) ? value.records : []).entries()) {
    if (errors.length >= INPUT_LIMITS.errors) break
    const path = `records[${index}]`
    if (!object(record)) { addValidationError(errors, `${path} must be an object`); continue }
    keys(record, ['corridorId', 'geometry', 'inputScores', 'rawFeatures', 'prediction', 'observation', 'sourceProvenance'], errors, path)
    check(validId(record.corridorId) && !seen.has(String(record.corridorId)), `${path} requires a unique stable corridorId`)
    if (typeof record.corridorId === 'string') seen.add(record.corridorId)
    check(record.geometry === undefined || record.geometry === null || validGeometry(record.geometry), `${path} has invalid WGS84 geometry`)
    const scores = object(record.inputScores) ? record.inputScores : {}
    keys(scores, [...SCORE_KEYS], errors, `${path}.inputScores`)
    check(Object.keys(scores).length === SCORE_KEYS.length && SCORE_KEYS.every((key) => finite(scores[key]) && scores[key] <= 100), `${path} has invalid input scores`)
    const raw = object(record.rawFeatures) ? record.rawFeatures : {}
    check(Object.keys(raw).length > 0 && Object.keys(raw).length <= INPUT_LIMITS.rawFeatures && Object.values(raw).every((n) => n === null || typeof n === 'number' && Number.isFinite(n)), `${path} has invalid raw features`)
    const prediction = object(record.prediction) ? record.prediction : {}
    keys(prediction, ['relativeBicyclesPerObservedHour', 'uncertainty'], errors, `${path}.prediction`)
    const estimate = prediction.relativeBicyclesPerObservedHour
    check(finite(estimate), `${path}.prediction must be finite and nonnegative`)
    const uncertainty = object(prediction.uncertainty) ? prediction.uncertainty : {}
    keys(uncertainty, ['lower', 'upper', 'level', 'method'], errors, `${path}.prediction.uncertainty`)
    check(finite(uncertainty.lower) && finite(uncertainty.upper) && finite(estimate) && uncertainty.lower <= estimate && estimate <= uncertainty.upper && finite(uncertainty.level) && uncertainty.level > 0 && uncertainty.level < 1 && ['spatial-holdout-residual-quantile', 'bootstrap'].includes(String(uncertainty.method)), `${path} has an invalid uncertainty interval`)
    const observation = object(record.observation) ? record.observation : {}
    keys(observation, ['start', 'end'], errors, `${path}.observation`)
    check(date(observation.start) && date(observation.end) && observation.start <= observation.end && timestamp(value.generatedAt) && Date.parse(`${observation.end}T23:59:59Z`) <= Date.parse(value.generatedAt), `${path} has invalid observation dates`)
    check(Array.isArray(record.sourceProvenance) && record.sourceProvenance.length > 0 && record.sourceProvenance.length <= INPUT_LIMITS.sourceIds && record.sourceProvenance.every(validId) && new Set(record.sourceProvenance).size === record.sourceProvenance.length, `${path} requires unique source provenance IDs`)
  }
  return errors.length ? { ok: false, errors } : { ok: true, artifact: value as CorridorDemandArtifact }
}
