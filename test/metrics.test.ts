import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isRelevant, MAX_REQUIRED_OVERLAP, scoreQuestion } from '../src/metrics.js'
import type { Chunk } from '../src/types.js'

const c = (doc: string, start: number, end: number): Chunk => ({ id: `${doc}#${start}`, docId: doc, start, end, text: '' })
const span = { docId: 'a', start: 100, end: 200 } // 100-character quote

test('relevance needs half of a short quote and never more than the cap', () => {
  assert.equal(isRelevant(c('a', 0, 149), span), false) // 49 chars of overlap < 50
  assert.equal(isRelevant(c('a', 0, 150), span), true) // exactly 50
  assert.equal(isRelevant(c('b', 0, 1000), span), false, 'other document')
  const long = { docId: 'a', start: 0, end: 1000 }
  assert.equal(isRelevant(c('a', 0, MAX_REQUIRED_OVERLAP), long), true, 'cap: 150 chars are enough for a 1000-char quote')
  assert.equal(isRelevant(c('a', 0, MAX_REQUIRED_OVERLAP - 1), long), false)
})

test('MRR, hit, recall and nDCG on a hand-computed ranking', () => {
  // relevant chunk is at rank 3 of the top 5
  const ranked = [c('x', 0, 10), c('x', 10, 20), c('a', 90, 210), c('x', 20, 30), c('x', 30, 40)]
  const s = scoreQuestion(ranked, [span], 1, [1, 3, 5])
  assert.equal(s.firstRank, 3)
  assert.ok(Math.abs(s.reciprocalRank - 1 / 3) < 1e-12)
  assert.equal(s.byK[1]!.hit, 0)
  assert.equal(s.byK[3]!.hit, 1)
  assert.equal(s.byK[3]!.recall, 1)
  assert.ok(Math.abs(s.byK[3]!.ndcg - 1 / Math.log2(4)) < 1e-12, 'DCG = 1/log2(rank+1); ideal DCG = 1')
})

test('recall counts how many of several gold spans the top-k covers', () => {
  const spans = [span, { docId: 'b', start: 0, end: 100 }]
  const s = scoreQuestion([c('a', 100, 200), c('x', 0, 10)], spans, 2, [2])
  assert.equal(s.byK[2]!.recall, 0.5)
  assert.equal(s.byK[2]!.hit, 1)
})

test('nothing relevant retrieved scores zero everywhere', () => {
  const s = scoreQuestion([c('x', 0, 10)], [span], 1, [1, 5])
  assert.equal(s.firstRank, null)
  assert.equal(s.reciprocalRank, 0)
  assert.deepEqual(s.byK[5], { hit: 0, recall: 0, ndcg: 0 })
})

test('a relevant chunk beyond the largest k does not earn reciprocal rank', () => {
  const ranked = [...Array.from({ length: 10 }, (_, i) => c('x', i, i + 1)), c('a', 100, 200)]
  const s = scoreQuestion(ranked, [span], 1, [1, 5, 10])
  assert.equal(s.firstRank, 11)
  assert.equal(s.reciprocalRank, 0)
})
