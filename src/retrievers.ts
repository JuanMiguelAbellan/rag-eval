import { Bm25Retriever } from './bm25.js'
import { cosine, type Embedder } from './embeddings.js'
import type { Chunk, Retriever, Scored } from './types.js'

export class DenseRetriever implements Retriever {
  readonly name: string
  private constructor(
    private readonly embedder: Embedder,
    private readonly vectors: number[][],
  ) {
    this.name = embedder.name
  }

  static async build(chunks: Chunk[], embedder: Embedder): Promise<DenseRetriever> {
    const vectors = await embedder.embed(chunks.map((c) => c.text), 'document')
    return new DenseRetriever(embedder, vectors)
  }

  async retrieve(query: string, k: number): Promise<Scored[]> {
    const [q] = await this.embedder.embed([query], 'query')
    return this.vectors
      .map((v, index) => ({ index, score: cosine(q!, v) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
  }
}

/** Reciprocal Rank Fusion: score(d) = Σ 1 / (rrfK + rank_i(d)). Rank-based, so it needs no score
 *  calibration between BM25 (unbounded) and cosine similarity (−1..1). */
export function reciprocalRankFusion(lists: Scored[][], k: number, rrfK = 60): Scored[] {
  const fused = new Map<number, number>()
  for (const list of lists) {
    list.forEach((s, rank) => fused.set(s.index, (fused.get(s.index) ?? 0) + 1 / (rrfK + rank + 1)))
  }
  return [...fused.entries()]
    .map(([index, score]) => ({ index, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

export class HybridRetriever implements Retriever {
  readonly name: string
  constructor(
    private readonly parts: Retriever[],
    private readonly candidates = 50,
  ) {
    this.name = `hybrid(${parts.map((p) => p.name).join(' + ')})`
  }

  async retrieve(query: string, k: number): Promise<Scored[]> {
    const lists = await Promise.all(this.parts.map((p) => p.retrieve(query, this.candidates)))
    return reciprocalRankFusion(lists, k)
  }
}

export { Bm25Retriever }
