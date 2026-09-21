import { chunkCorpus, specName, type ChunkerSpec } from './chunking.js'
import { resolveGold } from './dataset.js'
import { OllamaEmbedder, type Embedder } from './embeddings.js'
import { answerQuestion, type Condition, type GenerationOutcome } from './generation.js'
import { isRelevant, mean, scoreQuestion, type QuestionScore, type ResolvedSpan } from './metrics.js'
import { Bm25Retriever, DenseRetriever, HybridRetriever } from './retrievers.js'
import type { Chunk, Doc, Question, Retriever } from './types.js'

// ---------------------------------------------------------------- embedders

export const EMBEDDERS: Record<string, () => OllamaEmbedder> = {
  // What IADocuments runs today: raw text, no task prefixes.
  'nomic-raw': () => new OllamaEmbedder({ label: 'nomic-embed-text (raw, as in IADocuments)', model: 'nomic-embed-text' }),
  // Same model, but with the prefixes its authors specify for retrieval.
  'nomic-prefix': () =>
    new OllamaEmbedder({
      label: 'nomic-embed-text (task prefixes)',
      model: 'nomic-embed-text',
      queryPrefix: 'search_query: ',
      documentPrefix: 'search_document: ',
    }),
  // Multilingual model; needs no prefixes.
  'bge-m3': () => new OllamaEmbedder({ label: 'bge-m3', model: 'bge-m3' }),
}

export interface RetrieverSpec {
  key: string
  label: string
  build(chunks: Chunk[], embedders: Map<string, OllamaEmbedder>): Promise<Retriever>
}

function embedderFor(embedders: Map<string, OllamaEmbedder>, key: string): OllamaEmbedder {
  let e = embedders.get(key)
  if (!e) {
    e = EMBEDDERS[key]!()
    embedders.set(key, e)
  }
  return e
}

export const RETRIEVERS: RetrieverSpec[] = [
  { key: 'bm25', label: 'BM25', build: async (chunks) => new Bm25Retriever(chunks) },
  { key: 'nomic-raw', label: 'nomic (raw) — IADocuments today', build: (c, e) => DenseRetriever.build(c, embedderFor(e, 'nomic-raw')) },
  { key: 'nomic-prefix', label: 'nomic (task prefixes)', build: (c, e) => DenseRetriever.build(c, embedderFor(e, 'nomic-prefix')) },
  { key: 'bge-m3', label: 'bge-m3', build: (c, e) => DenseRetriever.build(c, embedderFor(e, 'bge-m3')) },
  {
    key: 'hybrid-bge',
    label: 'hybrid: BM25 + bge-m3 (RRF)',
    build: async (c, e) => new HybridRetriever([new Bm25Retriever(c), await DenseRetriever.build(c, embedderFor(e, 'bge-m3'))]),
  },
  {
    key: 'hybrid-nomic',
    label: 'hybrid: BM25 + nomic prefixed (RRF)',
    build: async (c, e) => new HybridRetriever([new Bm25Retriever(c), await DenseRetriever.build(c, embedderFor(e, 'nomic-prefix'))]),
  },
]

export const CHUNKERS: ChunkerSpec[] = [
  { kind: 'fixed', size: 1000, overlap: 150 }, // IADocuments today
  { kind: 'fixed', size: 500, overlap: 75 },
  { kind: 'fixed', size: 300, overlap: 50 },
  { kind: 'paragraph', maxChars: 1000 },
  { kind: 'paragraph', maxChars: 500 },
]

// ---------------------------------------------------------------- retrieval

export const KS = [1, 3, 5, 10]

export interface RetrievalRun {
  chunker: string
  retriever: string
  retrieverLabel: string
  numChunks: number
  meanChunkChars: number
  /** aggregated over answerable questions */
  metrics: { mrr: number; byK: Record<number, { hit: number; recall: number; ndcg: number }> }
  /** per-question scores, keyed by question id — kept so reports can do paired significance tests */
  perQuestion: Record<string, QuestionScore>
}

export interface RetrievalResults {
  generatedAt: string
  numAnswerable: number
  numDocs: number
  runs: RetrievalRun[]
}

export async function runRetrieval(
  docs: Doc[],
  questions: Question[],
  chunkers: ChunkerSpec[],
  retrievers: RetrieverSpec[],
  log: (msg: string) => void = () => {},
): Promise<RetrievalResults> {
  const docsById = new Map(docs.map((d) => [d.id, d]))
  const answerable = questions.filter((q) => q.answerable)
  const spans = new Map<string, ResolvedSpan[]>(answerable.map((q) => [q.id, resolveGold(q, docsById)]))
  const embedders = new Map<string, OllamaEmbedder>()
  const runs: RetrievalRun[] = []

  for (const spec of chunkers) {
    const chunks = chunkCorpus(docs, spec)
    const totalRelevant = new Map(answerable.map((q) => [q.id, chunks.filter((c) => spans.get(q.id)!.some((s) => isRelevant(c, s))).length]))
    for (const rspec of retrievers) {
      const t0 = Date.now()
      const retriever = await rspec.build(chunks, embedders)
      const perQuestion: Record<string, QuestionScore> = {}
      for (const q of answerable) {
        const top = await retriever.retrieve(q.question, Math.max(...KS))
        perQuestion[q.id] = scoreQuestion(top.map((s) => chunks[s.index]!), spans.get(q.id)!, totalRelevant.get(q.id)!, KS)
      }
      const scores = Object.values(perQuestion)
      const byK: RetrievalRun['metrics']['byK'] = {}
      for (const k of KS) {
        byK[k] = {
          hit: mean(scores.map((s) => s.byK[k]!.hit)),
          recall: mean(scores.map((s) => s.byK[k]!.recall)),
          ndcg: mean(scores.map((s) => s.byK[k]!.ndcg)),
        }
      }
      runs.push({
        chunker: specName(spec),
        retriever: rspec.key,
        retrieverLabel: rspec.label,
        numChunks: chunks.length,
        meanChunkChars: Math.round(mean(chunks.map((c) => c.text.length))),
        metrics: { mrr: mean(scores.map((s) => s.reciprocalRank)), byK },
        perQuestion,
      })
      log(`${specName(spec).padEnd(12)} ${rspec.key.padEnd(13)} MRR ${runs.at(-1)!.metrics.mrr.toFixed(3)}  recall@5 ${byK[5]!.recall.toFixed(3)}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
    }
  }
  return { generatedAt: new Date().toISOString(), numAnswerable: answerable.length, numDocs: docs.length, runs }
}

// --------------------------------------------------------------- generation

export interface GenerationConfig {
  label: string
  condition: Condition
  chunker?: ChunkerSpec
  retriever?: string
  k?: number
}

export interface GenerationRun {
  label: string
  condition: Condition
  chunker?: string
  retriever?: string
  k?: number
  outcomes: GenerationOutcome[]
}

export interface GenerationResults {
  generatedAt: string
  model: string
  runs: GenerationRun[]
}

/** The paragraph (one source line) that contains a gold span — the "perfect context" for the oracle condition. */
function oraclePassage(doc: Doc, span: ResolvedSpan): string {
  const start = doc.text.lastIndexOf('\n', span.start) + 1
  const nl = doc.text.indexOf('\n', span.end)
  return doc.text.slice(start, nl < 0 ? doc.text.length : nl)
}

export async function runGeneration(
  docs: Doc[],
  questions: Question[],
  configs: GenerationConfig[],
  model: string,
  log: (msg: string) => void = () => {},
): Promise<GenerationResults> {
  const docsById = new Map(docs.map((d) => [d.id, d]))
  const embedders = new Map<string, OllamaEmbedder>()
  const runs: GenerationRun[] = []

  for (const cfg of configs) {
    let retriever: Retriever | undefined
    let chunks: Chunk[] = []
    if (cfg.condition === 'rag') {
      chunks = chunkCorpus(docs, cfg.chunker!)
      retriever = await RETRIEVERS.find((r) => r.key === cfg.retriever)!.build(chunks, embedders)
    }
    const outcomes: GenerationOutcome[] = []
    const pool = cfg.condition === 'rag' ? questions : cfg.condition === 'oracle' ? questions.filter((q) => q.answerable) : questions.filter((q) => q.answerable)
    for (const q of pool) {
      let passages: string[] = []
      if (cfg.condition === 'rag') {
        passages = (await retriever!.retrieve(q.question, cfg.k!)).map((s) => chunks[s.index]!.text)
      } else if (cfg.condition === 'oracle') {
        passages = [...new Set(resolveGold(q, docsById).map((s) => oraclePassage(docsById.get(s.docId)!, s)))]
      }
      outcomes.push(await answerQuestion(q, passages, cfg.condition, { model }))
    }
    runs.push({ label: cfg.label, condition: cfg.condition, chunker: cfg.chunker && specName(cfg.chunker), retriever: cfg.retriever, k: cfg.k, outcomes })
    const ans = outcomes.filter((o) => questions.find((q) => q.id === o.questionId)!.answerable)
    log(`${cfg.label.padEnd(44)} answerable accuracy ${(mean(ans.map((o) => (o.correct ? 1 : 0))) * 100).toFixed(1)}%`)
  }
  return { generatedAt: new Date().toISOString(), model, runs }
}

export type { Embedder }
