import type { Chunk } from './types.js'

export interface ResolvedSpan {
  docId: string
  start: number
  end: number
}

/** Cap on how much of a gold quote a chunk must contain to count as relevant. Without it, a long quote
 *  (some are ~500 characters) could never be "half covered" by a 300-character chunk, which would punish
 *  small chunks for a labelling artefact rather than a retrieval failure. */
export const MAX_REQUIRED_OVERLAP = 150

/** A chunk is relevant to a gold span when it contains at least half of the span's characters, or
 *  MAX_REQUIRED_OVERLAP characters, whichever is smaller. Defined on character offsets, so it works
 *  for any chunking strategy. */
export function isRelevant(chunk: Chunk, span: ResolvedSpan, minCoverage = 0.5): boolean {
  if (chunk.docId !== span.docId) return false
  const overlap = Math.min(chunk.end, span.end) - Math.max(chunk.start, span.start)
  return overlap > 0 && overlap >= Math.min(minCoverage * (span.end - span.start), MAX_REQUIRED_OVERLAP)
}

export interface KScore {
  /** 1 if any gold span is covered by the top-k. */
  hit: number
  /** fraction of gold spans covered by the top-k (matters for questions needing several passages). */
  recall: number
  ndcg: number
}

export interface QuestionScore {
  /** 1-based rank of the first relevant chunk, or null if none was retrieved. */
  firstRank: number | null
  reciprocalRank: number
  byK: Record<number, KScore>
}

export function scoreQuestion(ranked: Chunk[], spans: ResolvedSpan[], totalRelevant: number, ks: number[]): QuestionScore {
  const relevant = ranked.map((c) => spans.some((s) => isRelevant(c, s)))
  const firstIdx = relevant.indexOf(true)
  const maxK = Math.max(...ks)
  const byK: Record<number, KScore> = {}
  for (const k of ks) {
    const top = ranked.slice(0, k)
    const covered = spans.filter((s) => top.some((c) => isRelevant(c, s))).length
    let dcg = 0
    top.forEach((_, i) => {
      if (relevant[i]) dcg += 1 / Math.log2(i + 2)
    })
    let idcg = 0
    for (let i = 0; i < Math.min(k, Math.max(1, totalRelevant)); i++) idcg += 1 / Math.log2(i + 2)
    byK[k] = { hit: covered > 0 ? 1 : 0, recall: covered / spans.length, ndcg: idcg ? dcg / idcg : 0 }
  }
  return {
    firstRank: firstIdx >= 0 ? firstIdx + 1 : null,
    reciprocalRank: firstIdx >= 0 && firstIdx < maxK ? 1 / (firstIdx + 1) : 0,
    byK,
  }
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0
}
