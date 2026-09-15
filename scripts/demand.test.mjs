import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validateDemand } from './validate-demand.mjs'

const read = async file => JSON.parse(await readFile(new URL(`../public/data/${file}`, import.meta.url), 'utf8'))
const source = await read('corridor-demand.json')
const manifest = await read('data-manifest.json')
const catalogue = await read('candidate-catalogue.geojson')
const errors = artifact => validateDemand(artifact, manifest, catalogue)

test('real demand export passes schema, provenance and candidate joins', () => assert.deepEqual(errors(source), []))
test('rejects geographic leakage and false baseline eligibility', () => {
  const artifact = structuredClone(source)
  artifact.model.validation.testGroupIds.push(artifact.model.validation.trainGroupIds[0])
  assert.ok(errors(artifact).some(error => error.includes('overlap')))
  artifact.model.validation.modelValue = artifact.model.validation.medianBaselineValue + 1
  artifact.model.productionEligible = true
  assert.ok(errors(artifact).some(error => error.includes('productionEligible')))
})
test('rejects scenarios and fabricated source references in A export', () => {
  const artifact = structuredClone(source)
  artifact.records[0].after = { lowStressTrips: 100 }
  assert.ok(errors(artifact).some(error => error.includes('additional properties')))
  delete artifact.records[0].after
  artifact.records[0].sourceProvenance.push('nonexistent-source')
  assert.ok(errors(artifact).some(error => error.includes('Unresolved')))
})
test('rejects reversed uncertainty, duplicate IDs and score aliases', () => {
  const artifact = structuredClone(source)
  artifact.records[0].prediction.uncertainty.lower = artifact.records[0].prediction.uncertainty.upper + 1
  artifact.records.push(structuredClone(artifact.records[0]))
  assert.ok(errors(artifact).some(error => error.includes('Uncertainty')))
  assert.ok(errors(artifact).some(error => error.includes('Duplicate')))
  artifact.records[0].inputScores.current_demand = 1
  assert.ok(errors(artifact).some(error => error.includes('additional properties')))
})
