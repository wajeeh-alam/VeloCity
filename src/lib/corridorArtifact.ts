import type {
  CandidateProvenance,
  ObservedDemandProvenance,
  SimulationMetrics,
} from './corridorDomain.ts'
import {
  SCORE_KEYS,
  normalizeScoreInputs,
  type ScoreInputs,
} from './corridorScoring.ts'

export const PREDICTION_ARTIFACT_SCHEMA_VERSION =
  'velocity.corridor-predictions.v1' as const

export type SpatialValidation = {
  strategy: 'spatial-holdout'
  metric: 'mae' | 'rmse'
  modelValue: number
  medianBaselineValue: number
  lowerIsBetter: true
}

export type PredictionArtifactModel = {
  id: string
  version: string
  trainedAt: string
  datasetManifestVersion: string
  target: 'relative-bicycles-per-observed-hour'
  validation: SpatialValidation
  productionEligible: boolean
}

export type CorridorPredictionRecord = {
  corridorId: string
  rolloutYear: 1 | 2 | 3
  inputScores: ScoreInputs
  before: SimulationMetrics
  after: SimulationMetrics
  representativeAgentCount: number
  agentSeed: number
  beforePath: string
  afterPath: string
  candidateProvenance: CandidateProvenance
  observedDemandProvenance: ObservedDemandProvenance
  /** IDs already active at this portfolio horizon. */
  activeCorridorIds: string[]
}

export type CorridorPredictionArtifact = {
  schemaVersion: typeof PREDICTION_ARTIFACT_SCHEMA_VERSION
  artifactId: string
  generatedAt: string
  model: PredictionArtifactModel
  records: CorridorPredictionRecord[]
}

export type ArtifactParseResult =
  | { ok: true; artifact: CorridorPredictionArtifact; warnings: string[] }
  | { ok: false; errors: string[] }

const METRIC_MAX: Readonly<Record<keyof SimulationMetrics, number>> = {
  lowStressTrips: 10_000_000,
  populationConnected: 20_000_000,
  destinationsReached: 1_000_000,
  dangerousSegments: 1_000_000,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(
  source: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[],
): string {
  const value = source[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${path}.${key} must be a non-empty string`)
    return ''
  }
  return value.trim()
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function validateIsoDate(value: string, path: string, errors: string[]): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(
    value,
  )
  if (!match || !Number.isFinite(Date.parse(value))) {
    errors.push(`${path} must be an ISO-8601 date or timestamp`)
    return
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const calendarDate = new Date(Date.UTC(year, month - 1, day))
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    errors.push(`${path} is not a valid calendar date`)
  }
}

function finiteNumber(
  source: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[],
): number {
  const value = source[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${path}.${key} must be a finite number`)
    return 0
  }
  return value
}

function parseMetrics(
  value: unknown,
  path: string,
  errors: string[],
): SimulationMetrics {
  const source = isRecord(value) ? value : {}
  if (!isRecord(value)) errors.push(`${path} must be an object`)

  return Object.fromEntries(
    (Object.keys(METRIC_MAX) as Array<keyof SimulationMetrics>).map((key) => {
      const metric = finiteNumber(source, key, path, errors)
      if (!Number.isInteger(metric) || metric < 0 || metric > METRIC_MAX[key]) {
        errors.push(
          `${path}.${key} must be an integer between 0 and ${METRIC_MAX[key]}`,
        )
      }
      return [key, Math.round(Math.min(METRIC_MAX[key], Math.max(0, metric)))]
    }),
  ) as SimulationMetrics
}

function parseScoreInputs(
  value: unknown,
  path: string,
  errors: string[],
): ScoreInputs {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object containing all nine scores`)
    return normalizeScoreInputs({})
  }

  for (const key of SCORE_KEYS) {
    const score = value[key]
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
      errors.push(`${path}.${key} must be a finite number between 0 and 100`)
    }
  }
  return normalizeScoreInputs(value)
}

function parseCandidateProvenance(
  value: unknown,
  path: string,
  errors: string[],
): CandidateProvenance {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return { kind: 'exploratory', sourceName: 'Unknown' }
  }
  const kind = value.kind
  const sourceName = requiredString(value, 'sourceName', path, errors)
  if (kind === 'plan-backed') {
    const sourceUrl = requiredString(value, 'sourceUrl', path, errors)
    if (sourceUrl && !isHttpUrl(sourceUrl)) errors.push(`${path}.sourceUrl must be an HTTP(S) URL`)
    const sourceRecordId =
      typeof value.sourceRecordId === 'string' && value.sourceRecordId.trim()
        ? value.sourceRecordId.trim()
        : undefined
    if (value.sourceRecordId !== undefined && sourceRecordId === undefined) {
      errors.push(`${path}.sourceRecordId must be a non-empty string when provided`)
    }
    return { kind, sourceName, sourceUrl, sourceRecordId }
  }
  if (kind === 'exploratory') {
    const sourceUrl =
      typeof value.sourceUrl === 'string' && value.sourceUrl.trim()
        ? value.sourceUrl.trim()
        : undefined
    if (value.sourceUrl !== undefined && sourceUrl === undefined) {
      errors.push(`${path}.sourceUrl must be a non-empty string when provided`)
    }
    if (sourceUrl && !isHttpUrl(sourceUrl)) errors.push(`${path}.sourceUrl must be an HTTP(S) URL`)
    return { kind, sourceName, sourceUrl }
  }
  errors.push(`${path}.kind must be "plan-backed" or "exploratory"`)
  return { kind: 'exploratory', sourceName: sourceName || 'Unknown' }
}

function parseObservedDemandProvenance(
  value: unknown,
  path: string,
  errors: string[],
): ObservedDemandProvenance {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return {
      kind: 'multiple-observed-sources',
      sourceName: 'Unknown',
      sourceUrls: [],
      observationStart: '',
      observationEnd: '',
    }
  }
  const kind = value.kind
  const sourceName = requiredString(value, 'sourceName', path, errors)
  const observationStart = requiredString(value, 'observationStart', path, errors)
  const observationEnd = requiredString(value, 'observationEnd', path, errors)
  validateIsoDate(observationStart, `${path}.observationStart`, errors)
  validateIsoDate(observationEnd, `${path}.observationEnd`, errors)
  if (
    Number.isFinite(Date.parse(observationStart)) &&
    Number.isFinite(Date.parse(observationEnd)) &&
    Date.parse(observationEnd) < Date.parse(observationStart)
  ) {
    errors.push(`${path}.observationEnd must not precede observationStart`)
  }

  if (kind === 'bike-share-od' || kind === 'counter-observation') {
    const sourceUrl = requiredString(value, 'sourceUrl', path, errors)
    if (sourceUrl && !isHttpUrl(sourceUrl)) errors.push(`${path}.sourceUrl must be an HTTP(S) URL`)
    if (kind === 'bike-share-od') {
      const tripCount =
        typeof value.tripCount === 'number' && Number.isInteger(value.tripCount) && value.tripCount >= 0
          ? value.tripCount
          : undefined
      if (value.tripCount !== undefined && tripCount === undefined) {
        errors.push(`${path}.tripCount must be a non-negative integer when provided`)
      }
      return { kind, sourceName, sourceUrl, observationStart, observationEnd, tripCount }
    }
    const observedHours =
      typeof value.observedHours === 'number' && Number.isFinite(value.observedHours) && value.observedHours >= 0
        ? value.observedHours
        : undefined
    if (value.observedHours !== undefined && observedHours === undefined) {
      errors.push(`${path}.observedHours must be a non-negative number when provided`)
    }
    return { kind, sourceName, sourceUrl, observationStart, observationEnd, observedHours }
  }

  if (kind === 'multiple-observed-sources') {
    const sourceUrls = Array.isArray(value.sourceUrls)
      ? value.sourceUrls
          .filter((item): item is string => typeof item === 'string')
          .map((url) => url.trim())
      : []
    if (
      !Array.isArray(value.sourceUrls) ||
      value.sourceUrls.some((item) => typeof item !== 'string') ||
      sourceUrls.length === 0 ||
      sourceUrls.some((url) => !isHttpUrl(url))
    ) {
      errors.push(`${path}.sourceUrls must contain at least one HTTP(S) URL`)
    }
    return { kind, sourceName, sourceUrls, observationStart, observationEnd }
  }

  errors.push(
    `${path}.kind must identify bike-share OD, counter observations, or multiple observed sources`,
  )
  return {
    kind: 'multiple-observed-sources',
    sourceName: sourceName || 'Unknown',
    sourceUrls: [],
    observationStart,
    observationEnd,
  }
}

function parseRecord(
  value: unknown,
  index: number,
  errors: string[],
): CorridorPredictionRecord {
  const path = `records[${index}]`
  const source = isRecord(value) ? value : {}
  if (!isRecord(value)) errors.push(`${path} must be an object`)

  const corridorId = requiredString(source, 'corridorId', path, errors)
  const rolloutYear = finiteNumber(source, 'rolloutYear', path, errors)
  if (![1, 2, 3].includes(rolloutYear)) {
    errors.push(`${path}.rolloutYear must be 1, 2, or 3`)
  }
  const representativeAgentCount = finiteNumber(
    source,
    'representativeAgentCount',
    path,
    errors,
  )
  if (
    !Number.isInteger(representativeAgentCount) ||
    representativeAgentCount < 1 ||
    representativeAgentCount > 100
  ) {
    errors.push(`${path}.representativeAgentCount must be an integer from 1 to 100`)
  }
  const agentSeed = finiteNumber(source, 'agentSeed', path, errors)
  if (!Number.isSafeInteger(agentSeed)) {
    errors.push(`${path}.agentSeed must be a safe integer`)
  }

  const before = parseMetrics(source.before, `${path}.before`, errors)
  const after = parseMetrics(source.after, `${path}.after`, errors)
  if (after.lowStressTrips < before.lowStressTrips) {
    errors.push(`${path}.after.lowStressTrips must be at least the before value`)
  }
  if (after.populationConnected < before.populationConnected) {
    errors.push(`${path}.after.populationConnected must be at least the before value`)
  }
  if (after.destinationsReached < before.destinationsReached) {
    errors.push(`${path}.after.destinationsReached must be at least the before value`)
  }
  if (after.dangerousSegments > before.dangerousSegments) {
    errors.push(`${path}.after.dangerousSegments must not exceed the before value`)
  }

  const rawActiveCorridorIds = source.activeCorridorIds
  const activeCorridorIds = Array.isArray(rawActiveCorridorIds)
    ? rawActiveCorridorIds
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : []
  if (!Array.isArray(rawActiveCorridorIds)) {
    errors.push(`${path}.activeCorridorIds must be an array`)
  } else if (
    rawActiveCorridorIds.some(
      (item) => typeof item !== 'string' || item.trim().length === 0,
    )
  ) {
    errors.push(`${path}.activeCorridorIds must contain only non-empty strings`)
  }
  if (new Set(activeCorridorIds).size !== activeCorridorIds.length) {
    errors.push(`${path}.activeCorridorIds must not contain duplicates`)
  }

  return {
    corridorId,
    rolloutYear: [1, 2, 3].includes(rolloutYear) ? (rolloutYear as 1 | 2 | 3) : 1,
    inputScores: parseScoreInputs(source.inputScores, `${path}.inputScores`, errors),
    before,
    after,
    representativeAgentCount: Math.round(
      Math.min(100, Math.max(1, representativeAgentCount)),
    ),
    agentSeed: Number.isSafeInteger(agentSeed) ? agentSeed : 1,
    beforePath: requiredString(source, 'beforePath', path, errors),
    afterPath: requiredString(source, 'afterPath', path, errors),
    candidateProvenance: parseCandidateProvenance(
      source.candidateProvenance,
      `${path}.candidateProvenance`,
      errors,
    ),
    observedDemandProvenance: parseObservedDemandProvenance(
      source.observedDemandProvenance,
      `${path}.observedDemandProvenance`,
      errors,
    ),
    activeCorridorIds: [...activeCorridorIds].sort(),
  }
}

/**
 * Strict synchronous adapter for the static JSON emitted by Member A. Fetching
 * can happen at application bootstrap; callers then pass the parsed artifact
 * to `simulateCorridor` without changing the existing one-argument API.
 */
export function parseCorridorPredictionArtifact(value: unknown): ArtifactParseResult {
  const errors: string[] = []
  const warnings: string[] = []
  if (!isRecord(value)) return { ok: false, errors: ['artifact must be an object'] }

  if (value.schemaVersion !== PREDICTION_ARTIFACT_SCHEMA_VERSION) {
    errors.push(
      `schemaVersion must equal ${PREDICTION_ARTIFACT_SCHEMA_VERSION}`,
    )
  }
  const artifactId = requiredString(value, 'artifactId', 'artifact', errors)
  const generatedAt = requiredString(value, 'generatedAt', 'artifact', errors)
  validateIsoDate(generatedAt, 'artifact.generatedAt', errors)

  const modelSource = isRecord(value.model) ? value.model : {}
  if (!isRecord(value.model)) errors.push('artifact.model must be an object')
  const validationSource = isRecord(modelSource.validation)
    ? modelSource.validation
    : {}
  if (!isRecord(modelSource.validation)) {
    errors.push('artifact.model.validation must be an object')
  }
  const strategy = validationSource.strategy
  const metric = validationSource.metric
  const lowerIsBetter = validationSource.lowerIsBetter
  if (strategy !== 'spatial-holdout') {
    errors.push('artifact.model.validation.strategy must be "spatial-holdout"')
  }
  if (metric !== 'mae' && metric !== 'rmse') {
    errors.push('artifact.model.validation.metric must be "mae" or "rmse"')
  }
  if (lowerIsBetter !== true) {
    errors.push('artifact.model.validation.lowerIsBetter must be true')
  }
  const modelValue = finiteNumber(
    validationSource,
    'modelValue',
    'artifact.model.validation',
    errors,
  )
  const medianBaselineValue = finiteNumber(
    validationSource,
    'medianBaselineValue',
    'artifact.model.validation',
    errors,
  )
  if (modelValue < 0 || medianBaselineValue < 0) {
    errors.push('artifact.model validation values must be non-negative')
  }
  const productionEligible = modelValue < medianBaselineValue
  if (!productionEligible) {
    warnings.push(
      'Model did not beat the spatial median baseline; predictions are parsed but will not be served.',
    )
  }

  const trainedAt = requiredString(modelSource, 'trainedAt', 'artifact.model', errors)
  validateIsoDate(trainedAt, 'artifact.model.trainedAt', errors)
  const modelId = requiredString(modelSource, 'id', 'artifact.model', errors)
  const modelVersion = requiredString(modelSource, 'version', 'artifact.model', errors)
  const datasetManifestVersion = requiredString(
    modelSource,
    'datasetManifestVersion',
    'artifact.model',
    errors,
  )
  const target = modelSource.target
  if (target !== 'relative-bicycles-per-observed-hour') {
    errors.push(
      'artifact.model.target must be "relative-bicycles-per-observed-hour"',
    )
  }

  if (!Array.isArray(value.records) || value.records.length === 0) {
    errors.push('artifact.records must be a non-empty array')
  }
  const records = Array.isArray(value.records)
    ? value.records.map((record, index) => parseRecord(record, index, errors))
    : []
  const recordKeys = new Set<string>()
  for (const record of records) {
    const key = JSON.stringify([
      record.corridorId,
      record.rolloutYear,
      record.activeCorridorIds,
    ])
    if (recordKeys.has(key)) {
      errors.push(`duplicate corridor/year/portfolio-state record: ${key}`)
    }
    recordKeys.add(key)
  }

  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    warnings,
    artifact: {
      schemaVersion: PREDICTION_ARTIFACT_SCHEMA_VERSION,
      artifactId,
      generatedAt,
      model: {
        id: modelId,
        version: modelVersion,
        trainedAt,
        datasetManifestVersion,
        target: 'relative-bicycles-per-observed-hour',
        validation: {
          strategy: 'spatial-holdout',
          metric: metric as 'mae' | 'rmse',
          modelValue,
          medianBaselineValue,
          lowerIsBetter: true,
        },
        productionEligible,
      },
      records,
    },
  }
}

export function scoreInputsMatch(
  left: ScoreInputs,
  right: ScoreInputs,
): boolean {
  const normalizedLeft = normalizeScoreInputs(left)
  const normalizedRight = normalizeScoreInputs(right)
  return SCORE_KEYS.every((key) => normalizedLeft[key] === normalizedRight[key])
}
