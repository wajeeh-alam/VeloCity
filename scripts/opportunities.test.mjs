import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { validateOpportunities } from './validate-opportunities.mjs'

const read = async file => JSON.parse(await readFile(new URL(`../public/data/${file}`, import.meta.url), 'utf8'))
const load = async () => ({
  artifact: await read('corridor-opportunities.json'),
  demand: await read('corridor-demand.json'),
  catalogue: await read('candidate-catalogue.geojson'),
})

test('C handoff validates and keeps trained evidence separate from scenarios', async () => {
  const { artifact, demand, catalogue } = await load()
  assert.deepEqual(validateOpportunities(artifact, demand, catalogue), [])
  assert.ok(artifact.records.every(record => record.evidence.status === 'trained-artifact'))
  assert.ok(artifact.records.every(record => record.comparison.status === 'synthetic-fallback'))
})

test('rejects modified evidence and unbalanced agents', async () => {
  const { artifact, demand, catalogue } = await load()
  artifact.records[0].evidence.inputScores.safety =
    artifact.records[0].evidence.inputScores.safety === 100 ? 99 : 100
  artifact.records[0].comparison.representativeAgents[0].weight += 1
  const failures = validateOpportunities(artifact, demand, catalogue)
  assert.ok(failures.some(item => item.includes('Evidence scores changed')))
  assert.ok(failures.some(item => item.includes('Agent weights')))
})

test('portfolio covers every corridor exactly once across Year 1–3', async () => {
  const { artifact } = await load()
  const ids = artifact.portfolio.years.flatMap(item => item.corridorIds)
  assert.equal(ids.length, artifact.records.length)
  assert.equal(new Set(ids).size, ids.length)
  assert.deepEqual(artifact.portfolio.years.map(item => item.year), [1, 2, 3])
})
