/** Seeded PRNG so bootstrap intervals are reproducible run to run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const meanOf = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / (xs.length || 1)

function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))
  return sorted[i]!
}

/** 95% bootstrap CI of the mean, resampling questions with replacement. */
export function bootstrapCI(values: number[], resamples = 2000, seed = 1): [number, number] {
  const rand = mulberry32(seed)
  const n = values.length
  const means: number[] = []
  for (let r = 0; r < resamples; r++) {
    let s = 0
    for (let i = 0; i < n; i++) s += values[Math.floor(rand() * n)]!
    means.push(s / n)
  }
  means.sort((a, b) => a - b)
  return [percentile(means, 0.025), percentile(means, 0.975)]
}

export interface PairedResult {
  meanDiff: number
  ci: [number, number]
  wins: number
  losses: number
  ties: number
}

/** Paired comparison on the same questions: mean(b − a) with a bootstrap CI. If the CI excludes 0 the
 *  difference is unlikely to be question-sampling noise. */
export function pairedBootstrap(a: number[], b: number[], resamples = 2000, seed = 1): PairedResult {
  if (a.length !== b.length) throw new Error('paired samples must have equal length')
  const diffs = a.map((x, i) => b[i]! - x)
  const [lo, hi] = bootstrapCI(diffs, resamples, seed)
  return {
    meanDiff: meanOf(diffs),
    ci: [lo, hi],
    wins: diffs.filter((d) => d > 1e-9).length,
    losses: diffs.filter((d) => d < -1e-9).length,
    ties: diffs.filter((d) => Math.abs(d) <= 1e-9).length,
  }
}
