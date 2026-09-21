import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { embed } from './ollama.js'

export type EmbedKind = 'query' | 'document'

export interface Embedder {
  /** Stable label used in reports, e.g. "nomic (task prefixes)". */
  name: string
  embed(texts: string[], kind: EmbedKind): Promise<number[][]>
}

export interface OllamaEmbedderOptions {
  label: string
  model: string
  /** Task prefixes some models require (nomic-embed-text: "search_query: " / "search_document: "). */
  queryPrefix?: string
  documentPrefix?: string
  batchSize?: number
  cacheDir?: string
  host?: string
}

function toBase64(v: number[]): string {
  return Buffer.from(new Float32Array(v).buffer).toString('base64')
}
function fromBase64(s: string): number[] {
  const b = Buffer.from(s, 'base64')
  return Array.from(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4))
}

/** Ollama embeddings with an on-disk cache keyed by (model, exact input text), so re-running an
 *  experiment never re-embeds anything, and the cache is shared between chunkers that produce identical chunks. */
export class OllamaEmbedder implements Embedder {
  readonly name: string
  private readonly cache = new Map<string, string>()
  private loaded = false
  private dirty = false
  private readonly cachePath: string

  constructor(private readonly o: OllamaEmbedderOptions) {
    this.name = o.label
    this.cachePath = join(o.cacheDir ?? '.cache/embeddings', `${o.model.replace(/[^\w.-]/g, '_')}.json`)
  }

  private key(text: string): string {
    return createHash('sha256').update(`${this.o.model}\u0000${text}`).digest('hex')
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = JSON.parse(await readFile(this.cachePath, 'utf8')) as Record<string, string>
      for (const [k, v] of Object.entries(raw)) this.cache.set(k, v)
    } catch {
      // no cache yet
    }
  }

  async flush(): Promise<void> {
    if (!this.dirty) return
    await mkdir(join(this.cachePath, '..'), { recursive: true })
    await writeFile(this.cachePath, JSON.stringify(Object.fromEntries(this.cache)))
    this.dirty = false
  }

  async embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
    await this.load()
    const prefix = (kind === 'query' ? this.o.queryPrefix : this.o.documentPrefix) ?? ''
    const inputs = texts.map((t) => prefix + t)
    const keys = inputs.map((t) => this.key(t))
    const missing = [...new Set(keys.filter((k) => !this.cache.has(k)).map((k) => keys.indexOf(k)))]
    const batchSize = this.o.batchSize ?? 16
    for (let i = 0; i < missing.length; i += batchSize) {
      const idx = missing.slice(i, i + batchSize)
      const vectors = await embed(this.o.model, idx.map((j) => inputs[j]!), { host: this.o.host })
      idx.forEach((j, n) => this.cache.set(keys[j]!, toBase64(vectors[n]!)))
      this.dirty = true
    }
    await this.flush()
    return keys.map((k) => fromBase64(this.cache.get(k)!))
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}
