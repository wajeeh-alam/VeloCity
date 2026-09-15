/// <reference types="node" />

import assert from 'node:assert/strict'
import test from 'node:test'
import { parseOpportunityArtifact } from './opportunities.ts'

const fixture = () => ({
  schemaVersion: 'velocity.corridor-opportunities.v1',
  artifactId: 'opportunities-test',
  evidenceArtifactId: 'demand-test',
  records: [
    {
      corridorId: 'corridor-1',
      evidence: { status: 'trained-artifact' },
      comparison: { status: 'synthetic-fallback' },
    },
  ],
})

test('Member C parser accepts explicit evidence and scenario statuses', () => {
  assert.equal(parseOpportunityArtifact(fixture()).records[0].corridorId, 'corridor-1')
})

test('Member C parser rejects duplicate IDs and ambiguous scenario status', () => {
  const duplicate = fixture()
  duplicate.records.push(structuredClone(duplicate.records[0]))
  assert.throws(() => parseOpportunityArtifact(duplicate), /Invalid opportunity record/)

  const ambiguous = fixture()
  ambiguous.records[0].comparison.status = 'trained-artifact'
  assert.throws(() => parseOpportunityArtifact(ambiguous), /Invalid opportunity record/)
})
