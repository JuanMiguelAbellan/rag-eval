import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HybridRetriever, reciprocalRankFusion } from '../src/retrievers.js'
import type { Retriever, Scored } from '../src/types.js'

const fixed = (name: string, order: number[]): Retriever => ({
  name,
  retrieve: async (_q, k): Promise<Scored[]> => order.slice(0, k).map((index, i) => ({ index, score: 100 - i })),
})

test('RRF rewards agreement between rankers over a single ranker\'s top pick', () => {
  const fused = reciprocalRankFusion(
    [
      [{ index: 7, score: 9 }, { index: 1, score: 8 }, { index: 2, score: 7 }],
      [{ index: 3, score: 9 }, { index: 1, score: 8 }, { index: 2, score: 7 }],
    ],
    3,
  )
  assert.equal(fused[0]!.index, 1, 'ranked 2nd by both beats ranked 1st by only one')
})

test('RRF is invariant to the score scale of each list', () => {
  const a = [{ index: 0, score: 0.9 }, { index: 1, score: 0.5 }]
  const b = [{ index: 1, score: 1e6 }, { index: 0, score: 1e5 }]
  const scaled = b.map((s) => ({ ...s, score: s.score / 1e6 }))
  assert.deepEqual(reciprocalRankFusion([a, b], 2), reciprocalRankFusion([a, scaled], 2))
})

test('RRF respects k and handles an empty list', () => {
  assert.equal(reciprocalRankFusion([[{ index: 1, score: 1 }, { index: 2, score: 1 }], []], 1).length, 1)
  assert.deepEqual(reciprocalRankFusion([[], []], 5), [])
})

test('hybrid retriever fuses its parts and names itself after them', async () => {
  const h = new HybridRetriever([fixed('bm25', [5, 1, 2]), fixed('dense', [9, 1, 2])])
  assert.equal(h.name, 'hybrid(bm25 + dense)')
  const top = await h.retrieve('q', 3)
  assert.equal(top[0]!.index, 1)
})
