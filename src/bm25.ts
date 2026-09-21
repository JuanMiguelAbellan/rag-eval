import { tokenize } from './text.js'
import type { Chunk, Retriever, Scored } from './types.js'

export interface Bm25Options {
  k1?: number
  b?: number
  stemPrefix?: number
}

/** Okapi BM25 over chunks. No dependencies: a term-frequency map per chunk plus document frequencies. */
export class Bm25Retriever implements Retriever {
  readonly name = 'bm25'
  private readonly tfs: Map<string, number>[]
  private readonly lengths: number[]
  private readonly df = new Map<string, number>()
  private readonly avgLen: number
  private readonly k1: number
  private readonly b: number
  private readonly stemPrefix: number

  constructor(chunks: Chunk[], { k1 = 1.5, b = 0.75, stemPrefix = 6 }: Bm25Options = {}) {
    this.k1 = k1
    this.b = b
    this.stemPrefix = stemPrefix
    this.tfs = []
    this.lengths = []
    for (const c of chunks) {
      const tokens = tokenize(c.text, { stemPrefix })
      const tf = new Map<string, number>()
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
      this.tfs.push(tf)
      this.lengths.push(tokens.length)
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1)
    }
    this.avgLen = this.lengths.reduce((a, l) => a + l, 0) / Math.max(1, this.lengths.length)
  }

  private idf(term: string): number {
    const n = this.tfs.length
    const df = this.df.get(term) ?? 0
    return Math.log(1 + (n - df + 0.5) / (df + 0.5))
  }

  async retrieve(query: string, k: number): Promise<Scored[]> {
    const terms = [...new Set(tokenize(query, { stemPrefix: this.stemPrefix }))]
    const scored: Scored[] = []
    for (let i = 0; i < this.tfs.length; i++) {
      const tf = this.tfs[i]!
      let score = 0
      for (const t of terms) {
        const f = tf.get(t)
        if (!f) continue
        const norm = f + this.k1 * (1 - this.b + (this.b * this.lengths[i]!) / this.avgLen)
        score += this.idf(t) * ((f * (this.k1 + 1)) / norm)
      }
      if (score > 0) scored.push({ index: i, score })
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, k)
  }
}
