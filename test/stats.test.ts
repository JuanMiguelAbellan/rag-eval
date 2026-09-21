import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bootstrapCI, mulberry32, pairedBootstrap } from '../src/stats.js'

test('the seeded generator is deterministic and within [0, 1)', () => {
  const a = mulberry32(42)
  const b = mulberry32(42)
  for (let i = 0; i < 100; i++) {
    const x = a()
    assert.equal(x, b())
    assert.ok(x >= 0 && x < 1)
  }
})

test('bootstrap CI brackets the sample mean and is reproducible', () => {
  const v = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? 1 : 0))
  const [lo, hi] = bootstrapCI(v, 1000, 7)
  assert.ok(lo <= 0.5 && 0.5 <= hi)
  assert.deepEqual(bootstrapCI(v, 1000, 7), [lo, hi])
  assert.ok(hi - lo < 0.4)
})

test('a constant sample has a degenerate interval', () => {
  assert.deepEqual(bootstrapCI([0.3, 0.3, 0.3, 0.3]), [0.3, 0.3])
})

test('paired bootstrap detects a consistent improvement and reports wins/losses/ties', () => {
  const a = Array.from({ length: 40 }, () => 0.2)
  const b = a.map((x, i) => (i < 30 ? x + 0.3 : x))
  const r = pairedBootstrap(a, b)
  assert.equal(r.wins, 30)
  assert.equal(r.ties, 10)
  assert.equal(r.losses, 0)
  assert.ok(r.ci[0] > 0, 'CI excludes zero')
  assert.ok(Math.abs(r.meanDiff - 0.225) < 1e-9)
})

test('paired bootstrap on identical samples is centred on zero', () => {
  const a = [0.1, 0.5, 0.9, 0.3]
  const r = pairedBootstrap(a, a)
  assert.equal(r.meanDiff, 0)
  assert.deepEqual(r.ci, [0, 0])
  assert.throws(() => pairedBootstrap([1], [1, 2]))
})
