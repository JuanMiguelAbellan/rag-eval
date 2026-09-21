import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ResolvedSpan } from './metrics.js'
import type { Doc, Question } from './types.js'

export async function loadCorpus(dir = 'corpus'): Promise<Doc[]> {
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as { id: string }[]
  return Promise.all(manifest.map(async (m) => ({ id: m.id, text: (await readFile(join(dir, `${m.id}.txt`), 'utf8')).replace(/\n$/, '') })))
}

export async function loadQuestions(path = 'dataset/questions.jsonl'): Promise<Question[]> {
  const raw = await readFile(path, 'utf8')
  return raw
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('//'))
    .map((l, i) => {
      try {
        return JSON.parse(l) as Question
      } catch (e) {
        throw new Error(`${path}:${i + 1}: invalid JSON (${(e as Error).message})`)
      }
    })
}

export function resolveGold(q: Question, docsById: Map<string, Doc>): ResolvedSpan[] {
  return (q.gold ?? []).map((g) => {
    const doc = docsById.get(g.doc)
    if (!doc) throw new Error(`${q.id}: unknown document "${g.doc}"`)
    const start = doc.text.indexOf(g.quote)
    if (start < 0) throw new Error(`${q.id}: gold quote not found verbatim in ${g.doc}: "${g.quote.slice(0, 60)}…"`)
    if (doc.text.indexOf(g.quote, start + 1) >= 0) throw new Error(`${q.id}: gold quote is ambiguous (appears twice) in ${g.doc}`)
    return { docId: g.doc, start, end: start + g.quote.length }
  })
}

export interface ValidationReport {
  errors: string[]
  answerable: number
  unanswerable: number
  byStyle: Record<string, number>
  perDoc: Record<string, number>
}

/** Every gold quote must exist verbatim (and once) in its document, every answerable question needs key facts,
 *  and unanswerable ones must not carry gold spans. */
export function validateDataset(questions: Question[], docs: Doc[]): ValidationReport {
  const docsById = new Map(docs.map((d) => [d.id, d]))
  const errors: string[] = []
  const seen = new Set<string>()
  const report: ValidationReport = { errors, answerable: 0, unanswerable: 0, byStyle: {}, perDoc: {} }
  for (const q of questions) {
    if (seen.has(q.id)) errors.push(`${q.id}: duplicate id`)
    seen.add(q.id)
    if (!q.question?.trim()) errors.push(`${q.id}: empty question`)
    if (q.answerable) {
      report.answerable++
      if (!q.gold?.length) errors.push(`${q.id}: answerable question without gold spans`)
      if (!q.keyFacts?.length || q.keyFacts.some((g) => !g.length)) errors.push(`${q.id}: answerable question without key facts`)
      try {
        for (const s of resolveGold(q, docsById)) report.perDoc[s.docId] = (report.perDoc[s.docId] ?? 0) + 1
      } catch (e) {
        errors.push((e as Error).message)
      }
      const style = q.style ?? 'unspecified'
      report.byStyle[style] = (report.byStyle[style] ?? 0) + 1
    } else {
      report.unanswerable++
      if (q.gold?.length) errors.push(`${q.id}: unanswerable question must not have gold spans`)
    }
  }
  return report
}
