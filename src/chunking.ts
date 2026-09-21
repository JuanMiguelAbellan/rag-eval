import type { Chunk, Doc } from './types.js'

export type ChunkerSpec =
  | { kind: 'fixed'; size: number; overlap: number }
  | { kind: 'paragraph'; maxChars: number }

export function specName(spec: ChunkerSpec): string {
  return spec.kind === 'fixed' ? `fixed-${spec.size}-${spec.overlap}` : `para-${spec.maxChars}`
}

/** Fixed character windows with overlap — the exact algorithm IADocuments uses in production
 *  (RAG_CHUNK_SIZE = 1000, RAG_CHUNK_SOLAPE = 150), so the baseline is the real system. */
function fixedWindows(doc: Doc, size: number, overlap: number): Chunk[] {
  if (overlap >= size) throw new Error('overlap must be smaller than size')
  const chunks: Chunk[] = []
  let start = 0
  while (start < doc.text.length) {
    const end = Math.min(start + size, doc.text.length)
    chunks.push({ id: `${doc.id}#${chunks.length}`, docId: doc.id, start, end, text: doc.text.slice(start, end) })
    if (end === doc.text.length) break
    start = end - overlap
  }
  return chunks
}

/** Structure-aware chunking: paragraphs (one per line) are merged greedily up to `maxChars`,
 *  never splitting a paragraph unless a single one is longer than the limit on its own. */
function paragraphChunks(doc: Doc, maxChars: number): Chunk[] {
  const units: { start: number; end: number }[] = []
  const re = /[^\n]+/g
  for (let m = re.exec(doc.text); m; m = re.exec(doc.text)) units.push({ start: m.index, end: m.index + m[0].length })

  const chunks: Chunk[] = []
  const push = (start: number, end: number) =>
    chunks.push({ id: `${doc.id}#${chunks.length}`, docId: doc.id, start, end, text: doc.text.slice(start, end) })

  let curStart = -1
  let curEnd = -1
  for (const u of units) {
    if (u.end - u.start > maxChars) {
      if (curStart >= 0) push(curStart, curEnd)
      curStart = -1
      for (const w of fixedWindows({ id: doc.id, text: doc.text.slice(u.start, u.end) }, maxChars, 0)) {
        push(u.start + w.start, u.start + w.end)
      }
      continue
    }
    if (curStart < 0) {
      curStart = u.start
      curEnd = u.end
    } else if (u.end - curStart <= maxChars) {
      curEnd = u.end
    } else {
      push(curStart, curEnd)
      curStart = u.start
      curEnd = u.end
    }
  }
  if (curStart >= 0) push(curStart, curEnd)
  return chunks
}

export function chunkDoc(doc: Doc, spec: ChunkerSpec): Chunk[] {
  return spec.kind === 'fixed' ? fixedWindows(doc, spec.size, spec.overlap) : paragraphChunks(doc, spec.maxChars)
}

export function chunkCorpus(docs: Doc[], spec: ChunkerSpec): Chunk[] {
  return docs.flatMap((d) => chunkDoc(d, spec))
}
