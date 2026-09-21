import { mean } from './metrics.js'
import { bootstrapCI, pairedBootstrap } from './stats.js'
import type { GenerationResults, RetrievalResults, RetrievalRun } from './experiments.js'
import type { Question } from './types.js'

export const BASELINE = { chunker: 'fixed-1000-150', retriever: 'nomic-raw' }

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const f3 = (x: number) => x.toFixed(3)
const signed = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(3)}`

function table(header: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n')
}

const key = (r: RetrievalRun) => `${r.chunker} / ${r.retrieverLabel}`
const ids = (r: RetrievalRun) => Object.keys(r.perQuestion).sort()
const series = (r: RetrievalRun, order: string[], pick: (s: RetrievalRun['perQuestion'][string]) => number) => order.map((id) => pick(r.perQuestion[id]!))

export function retrievalSection(res: RetrievalResults, questions: Question[]): string {
  const baseline = res.runs.find((r) => r.chunker === BASELINE.chunker && r.retriever === BASELINE.retriever)
  const order = ids(res.runs[0]!)
  const out: string[] = []

  out.push(`## Retrieval\n\n${res.numAnswerable} answerable questions over ${res.numDocs} documents. Relevance is defined on character offsets of a verbatim gold quote, so all chunkers are scored against the same ground truth. Sorted by MRR.\n`)
  const sorted = [...res.runs].sort((a, b) => b.metrics.mrr - a.metrics.mrr)
  out.push(
    table(
      ['#', 'chunking', 'retriever', 'chunks', 'MRR (95% CI)', 'recall@1', 'recall@3', 'recall@5', 'nDCG@5'],
      sorted.map((r, i) => {
        const [lo, hi] = bootstrapCI(series(r, order, (s) => s.reciprocalRank))
        const isBase = r === baseline
        const name = isBase ? `**${r.retrieverLabel}**` : r.retrieverLabel
        return [String(i + 1), isBase ? `**${r.chunker}**` : r.chunker, name, String(r.numChunks), `${f3(r.metrics.mrr)} (${f3(lo)}–${f3(hi)})`, pct(r.metrics.byK[1]!.recall), pct(r.metrics.byK[3]!.recall), pct(r.metrics.byK[5]!.recall), f3(r.metrics.byK[5]!.ndcg)]
      }),
    ),
  )

  if (baseline) {
    out.push(`\n### Against the production baseline\n\nBaseline (bold above): **${key(baseline)}** — what IADocuments runs today. Each row is a paired comparison on the same questions: mean difference in reciprocal rank with a 95% bootstrap CI, and how many questions got better / worse / stayed the same. A CI that excludes 0 means the difference is unlikely to be question-sampling noise.\n`)
    const rows = sorted
      .filter((r) => r !== baseline)
      .slice(0, 12)
      .map((r) => {
        const d = pairedBootstrap(series(baseline, order, (s) => s.reciprocalRank), series(r, order, (s) => s.reciprocalRank))
        const d5 = pairedBootstrap(series(baseline, order, (s) => s.byK[5]!.recall), series(r, order, (s) => s.byK[5]!.recall))
        const sig = d.ci[0] > 0 ? '✅ better' : d.ci[1] < 0 ? '⬇ worse' : '≈ not significant'
        return [key(r), `${signed(d.meanDiff)} [${signed(d.ci[0])}, ${signed(d.ci[1])}]`, `${signed(d5.meanDiff)} [${signed(d5.ci[0])}, ${signed(d5.ci[1])}]`, `${d.wins} / ${d.losses} / ${d.ties}`, sig]
      })
    out.push(table(['configuration', 'Δ MRR [95% CI]', 'Δ recall@5 [95% CI]', 'better / worse / same', 'verdict (MRR)'], rows))
  }

  // One change at a time: which factor is responsible for how much of the gain?
  if (baseline) {
    const find = (chunker: string, retriever: string) => res.runs.find((r) => r.chunker === chunker && r.retriever === retriever)
    const steps: [string, RetrievalRun | undefined][] = [
      ['add nomic task prefixes (`search_query:` / `search_document:`)', find(BASELINE.chunker, 'nomic-prefix')],
      ['paragraph chunking (≤1000 chars) instead of fixed windows', find('para-1000', BASELINE.retriever)],
      ['swap nomic-embed-text for bge-m3', find(BASELINE.chunker, 'bge-m3')],
      ['drop embeddings: BM25 only', find(BASELINE.chunker, 'bm25')],
      ['hybrid BM25 + bge-m3', find(BASELINE.chunker, 'hybrid-bge')],
      ['everything: paragraph chunking + hybrid BM25 + bge-m3', find('para-1000', 'hybrid-bge')],
    ]
    const rows = steps
      .filter((s): s is [string, RetrievalRun] => !!s[1])
      .map(([label, r]) => {
        const d = pairedBootstrap(series(baseline, order, (s) => s.reciprocalRank), series(r, order, (s) => s.reciprocalRank))
        const d5 = pairedBootstrap(series(baseline, order, (s) => s.byK[5]!.recall), series(r, order, (s) => s.byK[5]!.recall))
        return [label, f3(r.metrics.mrr), `${signed(d.meanDiff)} [${signed(d.ci[0])}, ${signed(d.ci[1])}]`, pct(r.metrics.byK[5]!.recall), `${signed(d5.meanDiff)} [${signed(d5.ci[0])}, ${signed(d5.ci[1])}]`]
      })
    out.push(`\n### One change at a time\n\nStarting from the baseline, each row changes **one** thing (paired bootstrap, 95% CI), plus the combined best.\n`)
    out.push(table(['change', 'MRR', 'Δ MRR [95% CI]', 'recall@5', 'Δ recall@5 [95% CI]'], rows))
  }

  // Chunk size, holding the retriever fixed.
  const sizeRows = ['nomic-raw', 'bge-m3', 'bm25'].flatMap((ret) =>
    ['fixed-300-50', 'fixed-500-75', 'fixed-1000-150', 'para-500', 'para-1000']
      .map((ch) => res.runs.find((r) => r.chunker === ch && r.retriever === ret))
      .filter((r): r is RetrievalRun => !!r)
      .map((r) => [r.retrieverLabel.split(' — ')[0]!, r.chunker, String(r.numChunks), String(r.meanChunkChars), f3(r.metrics.mrr), pct(r.metrics.byK[5]!.recall)]),
  )
  out.push(`\n### Chunking, holding the retriever fixed\n`)
  out.push(table(['retriever', 'chunking', 'chunks', 'mean chars', 'MRR', 'recall@5'], sizeRows))

  // Breakdown by question style for baseline vs best, to expose lexical-overlap bias.
  const styleOf = new Map(questions.map((q) => [q.id, q.style ?? 'unspecified']))
  const styles = [...new Set(order.map((id) => styleOf.get(id)!))].sort()
  if (styles.length > 1) {
    const focus = [baseline, sorted[0], sorted.find((r) => r.retriever === 'bm25' && r.chunker === BASELINE.chunker)].filter((r): r is RetrievalRun => !!r)
    const uniq = [...new Set(focus)]
    out.push(`\n### Lexical vs paraphrased questions\n\nQuestions worded close to the source text favour keyword search; paraphrased ones test whether the retriever understands meaning. MRR by question style:\n`)
    out.push(
      table(
        ['configuration', ...styles.map((s) => `${s} (n=${order.filter((id) => styleOf.get(id) === s).length})`)],
        uniq.map((r) => [key(r), ...styles.map((s) => f3(mean(order.filter((id) => styleOf.get(id) === s).map((id) => r.perQuestion[id]!.reciprocalRank))))]),
      ),
    )
  }
  return out.join('\n')
}

export function generationSection(res: GenerationResults, questions: Question[]): string {
  const answerable = new Set(questions.filter((q) => q.answerable).map((q) => q.id))
  const rows = res.runs.map((r) => {
    const ans = r.outcomes.filter((o) => answerable.has(o.questionId))
    const unans = r.outcomes.filter((o) => !answerable.has(o.questionId))
    const acc = mean(ans.map((o) => (o.correct ? 1 : 0)))
    const [lo, hi] = bootstrapCI(ans.map((o) => (o.correct ? 1 : 0)))
    const wrongAbstain = ans.filter((o) => o.abstained).length
    const hallucinated = unans.filter((o) => !o.abstained).length
    return [
      r.label,
      `${pct(acc)} (${pct(lo)}–${pct(hi)})`,
      `${wrongAbstain}/${ans.length}`,
      r.condition === 'rag' ? `${hallucinated}/${unans.length}` : '—',
      `${Math.round(mean(r.outcomes.map((o) => o.promptTokens)))}`,
      `${(mean(r.outcomes.map((o) => o.ms)) / 1000).toFixed(1)}s`,
    ]
  })
  // Paired comparison between consecutive RAG conditions on the same answerable questions.
  const byLabel = (needle: string) => res.runs.find((r) => r.label.startsWith(needle))
  const base = byLabel('RAG — IADocuments')
  const best = byLabel('RAG — best')
  const oracle = byLabel('oracle')
  const acc = (r: (typeof res.runs)[number]) => {
    const m = new Map(r.outcomes.map((o) => [o.questionId, o.correct ? 1 : 0]))
    return [...answerable].sort().map((id) => m.get(id)!)
  }
  const pairedLines: string[] = []
  for (const [a, b, label] of [
    [base, best, 'IADocuments today → best retrieval'],
    [best, oracle, 'best retrieval → oracle context (what perfect retrieval would still leave on the table)'],
  ] as const) {
    if (!a || !b) continue
    const d = pairedBootstrap(acc(a), acc(b))
    pairedLines.push(`- ${label}: ${signed(d.meanDiff * 100).replace(/(\.\d)\d*$/, '$1')} points [${(d.ci[0] * 100).toFixed(1)}, ${(d.ci[1] * 100).toFixed(1)}], ${d.wins} questions fixed, ${d.losses} broken, ${d.ties} unchanged`)
  }
  const paired = pairedLines.length ? `\n\nPaired comparison on the same ${answerable.size} answerable questions (95% bootstrap CI):\n\n${pairedLines.join('\n')}\n` : ''
  return [
    `## Answer quality (${res.model})\n`,
    'Deterministic scoring, no LLM judge: an answer is correct if it contains every key fact of the question (accent/case-insensitive). On unanswerable questions the correct behaviour is to say `NO_ENCONTRADO`.\n',
    table(['condition', 'accuracy, answerable (95% CI)', 'abstained wrongly', 'answered unanswerable (hallucination)', 'prompt tokens', 'latency'], rows),
    paired,
  ].join('\n')
}
