import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { evaluateScore } from '../src/lib/corridorScoring.ts'

const ROOT = new URL('../', import.meta.url)
const readJson = async path => JSON.parse(await readFile(new URL(path, ROOT), 'utf8'))
const round = (value, places = 0) => Number(value.toFixed(places))
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value))

function geometryEndpoints(geometry) {
  const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates
  const nonEmpty = lines.filter(line => Array.isArray(line) && line.length >= 2)
  return [nonEmpty[0][0].slice(0, 2), nonEmpty.at(-1).at(-1).slice(0, 2)]
}

function allocateAgents(corridorId, geometry, representedTrips) {
  if (representedTrips <= 0) return []
  const count = Math.min(
    24,
    representedTrips,
    Math.max(6, Math.ceil(representedTrips / 50)),
  )
  const baseWeight = Math.floor(representedTrips / count)
  const remainder = representedTrips - baseWeight * count
  const [start, end] = geometryEndpoints(geometry)
  return Array.from({ length: count }, (_, index) => {
    const reverse = index % 2 === 1
    return {
      id: `${corridorId}-agent-${String(index + 1).padStart(2, '0')}`,
      weight: baseWeight + (index < remainder ? 1 : 0),
      weightUnit: 'simulated-low-stress-trips-per-weekday',
      origin: reverse ? end : start,
      destination: reverse ? start : end,
      beforeRouteId: null,
      afterRouteId: `${corridorId}-candidate-alignment`,
    }
  })
}

function buildComparison(record, candidate, rolloutYear, beforeActiveCorridorIds) {
  const scores = record.inputScores
  const relativeDemand = record.prediction.relativeBicyclesPerObservedHour
  const referenceHourly = demand.model.normalization.referenceBicyclesPerHour
  const estimatedDailyDemand = Math.max(0, relativeDemand * referenceHourly * 24)
  const maturity = 0.82 + (rolloutYear - 1) * 0.09
  const currentLowStressShare = clamp(
    0.18 + scores.connectivity * 0.0035 - scores.coverage * 0.0012,
    0.08,
    0.62,
  )
  const lowStressUplift = estimatedDailyDemand * (
    0.08 +
    scores.potentialDemand * 0.003 +
    scores.connectivity * 0.0012 +
    scores.coverage * 0.001
  ) * maturity
  const population = record.rawFeatures.neighbourhood_population ?? 0
  const destinations = record.rawFeatures.evidence_destinations ?? 0
  const lengthKm = candidate.properties.lengthMetres / 1000
  const dangerousBefore = Math.max(1, Math.round(lengthKm * (0.7 + scores.safety * 0.035)))

  const before = {
    lowStressTrips: Math.round(estimatedDailyDemand * currentLowStressShare),
    populationConnected: Math.round(population * clamp(0.08 + scores.connectivity * 0.002, 0.08, 0.3)),
    destinationsReached: Math.round(destinations * clamp(0.2 + scores.connectivity * 0.005, 0.2, 0.7)),
    dangerousSegments: dangerousBefore,
  }
  const after = {
    lowStressTrips: before.lowStressTrips + Math.round(lowStressUplift),
    populationConnected: before.populationConnected + Math.round(
      population * (0.04 + scores.coverage * 0.0022 + scores.equity * 0.0008) * maturity,
    ),
    destinationsReached: Math.max(
      before.destinationsReached,
      Math.min(Math.round(destinations), before.destinationsReached + Math.round(
        destinations * (0.15 + scores.coverage * 0.004) * maturity,
      )),
    ),
    dangerousSegments: Math.max(
      0,
      dangerousBefore - Math.round(
        dangerousBefore * (0.18 + scores.safety * 0.0035 + scores.barriers * 0.001) * maturity,
      ),
    ),
  }
  const deltas = Object.fromEntries(
    Object.keys(before).map(key => [key, after[key] - before[key]]),
  )
  const afterActiveCorridorIds = [...beforeActiveCorridorIds, record.corridorId]

  return {
    status: 'synthetic-fallback',
    before,
    after,
    deltas,
    routeAlternatives: [
      {
        id: `${record.corridorId}-existing-condition`,
        kind: 'existing-condition',
        label: 'Existing network state (no route generated)',
        geometryRef: null,
        geometrySource: 'none',
      },
      {
        id: `${record.corridorId}-candidate-alignment`,
        kind: 'official-candidate-alignment',
        label: 'City candidate alignment',
        geometryRef: 'record.geometry',
        geometrySource: 'cycling-program-2025-2027',
      },
    ],
    selectedRouteId: `${record.corridorId}-candidate-alignment`,
    representativeAgents: allocateAgents(
      record.corridorId,
      candidate.geometry,
      deltas.lowStressTrips,
    ),
    networkState: {
      horizonYear: rolloutYear,
      beforeActiveCorridorIds,
      afterActiveCorridorIds,
    },
    warnings: [
      'Comparison metrics are deterministic illustrative proxies, not trained outputs or causal forecasts.',
      'No pathfinding was performed; the only mapped route is the official candidate alignment.',
      'Representative agents are synthetic and their weights sum to the simulated low-stress trip change.',
    ],
  }
}

const demand = await readJson('public/data/corridor-demand.json')
const catalogue = await readJson('public/data/candidate-catalogue.geojson')
const manifest = await readJson('public/data/data-manifest.json')
const candidates = new Map(catalogue.features.map(feature => [feature.id, feature]))
const tierOrder = { Top: 0, High: 1, Medium: 2, Low: 3 }

const ranked = demand.records
  .map(record => ({ record, score: evaluateScore(record.inputScores) }))
  .sort((left, right) =>
    tierOrder[left.score.tier] - tierOrder[right.score.tier] ||
    right.score.meanScore - left.score.meanScore ||
    left.record.corridorId.localeCompare(right.record.corridorId),
  )

const records = []
for (const [index, { record, score }] of ranked.entries()) {
  const candidate = candidates.get(record.corridorId)
  if (!candidate) throw new Error(`Missing candidate ${record.corridorId}`)
  const rolloutYear = index < 7 ? 1 : index < 14 ? 2 : 3
  const beforeActiveCorridorIds = records.map(item => item.corridorId)
  const sourceWarnings = manifest.limitations.filter(item => item.startsWith(`${record.corridorId}:`))
  const comparison = buildComparison(record, candidate, rolloutYear, beforeActiveCorridorIds)
  comparison.warnings.push(...sourceWarnings)
  records.push({
    corridorId: record.corridorId,
    name: candidate.properties.name,
    subtitle: [candidate.properties.fromStreet, candidate.properties.toStreet].filter(Boolean).join(' to '),
    sourceStatus: candidate.properties.sourceStatus,
    geometry: candidate.geometry,
    evidence: {
      status: 'trained-artifact',
      inputScores: record.inputScores,
      rawFeatures: record.rawFeatures,
      prediction: record.prediction,
      observation: record.observation,
      sourceProvenance: record.sourceProvenance,
      modelBeatBaseline: demand.model.productionEligible,
      modelValidation: {
        metric: demand.model.validation.metric,
        modelValue: demand.model.validation.modelValue,
        medianBaselineValue: demand.model.validation.medianBaselineValue,
      },
    },
    priority: {
      score: score.meanScore,
      tier: score.tier,
      strongInputCount: score.strongInputCount,
      rank: index + 1,
      rolloutYear,
    },
    comparison,
  })
}

const portfolio = {
  strategy: 'illustrative-evidence-priority-order',
  disclaimer: 'Year placement is an illustrative portfolio sequence based on the published nine-score rubric; it is not an official implementation schedule.',
  years: [1, 2, 3].map(year => ({
    year,
    corridorIds: records.filter(record => record.priority.rolloutYear === year).map(record => record.corridorId),
  })),
}
const fingerprint = createHash('sha256')
  .update(JSON.stringify({ evidenceArtifactId: demand.artifactId, portfolio, records }))
  .digest('hex')
  .slice(0, 16)
const artifact = {
  schemaVersion: 'velocity.corridor-opportunities.v1',
  artifactId: `opportunities-${fingerprint}`,
  generatedAt: demand.generatedAt,
  evidenceArtifactId: demand.artifactId,
  scenarioModel: {
    id: 'velocity-deterministic-scenario-v1',
    version: '1.0.0',
    nature: 'synthetic-fallback',
    generatedFrom: 'velocity.corridor-demand.v2',
    metricDefinitions: {
      lowStressTrips: { unit: 'simulated-trips-per-weekday', betterDirection: 'higher' },
      populationConnected: { unit: 'estimated-people', betterDirection: 'higher' },
      destinationsReached: { unit: 'school-locations', betterDirection: 'higher' },
      dangerousSegments: { unit: 'illustrative-high-stress-segments', betterDirection: 'lower' },
    },
    assumptions: [
      'Relative demand is converted to an illustrative daily quantity using the training-only reference rate and 24 hours.',
      'Accessibility and safety comparisons are deterministic functions of the nine evidence scores and raw population/destination proxies.',
      'No route choice, network accessibility, engineering feasibility, cost, or causal effect is estimated.',
    ],
  },
  portfolio,
  records,
}

await writeFile(
  new URL('public/data/corridor-opportunities.json', ROOT),
  `${JSON.stringify(artifact, null, 2)}\n`,
)
console.log(`Exported ${records.length} Member C opportunity profiles; ${artifact.artifactId}`)
