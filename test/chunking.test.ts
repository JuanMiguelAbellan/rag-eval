import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chunkDoc, specName } from '../src/chunking.js'

// The exact algorithm IADocuments ships (backend/Ollama/application/ia.usecases.ts), copied verbatim as a reference.
function iadocumentsChunks(texto: string, size = 1000, solape = 150): string[] {
  const out: string[] = []
  let inicio = 0
  while (inicio < texto.length) {
    const fin = Math.min(inicio + size, texto.length)
    out.push(texto.slice(inicio, fin))
    if (fin === texto.length) break
    inicio = fin - solape
  }
  return out
}

const longText = Array.from({ length: 400 }, (_, i) => `palabra${i}`).join(' ')

test('fixed windows reproduce the production chunker exactly', () => {
  const ours = chunkDoc({ id: 'd', text: longText }, { kind: 'fixed', size: 1000, overlap: 150 }).map((c) => c.text)
  assert.deepEqual(ours, iadocumentsChunks(longText))
})

test('every chunk is a contiguous slice of its document, and together they cover it', () => {
  for (const spec of [
    { kind: 'fixed', size: 300, overlap: 50 },
    { kind: 'paragraph', maxChars: 200 },
  ] as const) {
    const text = 'Primer párrafo corto.\nSegundo párrafo un poco más largo que el anterior.\n\nTercero.\n' + longText
    const chunks = chunkDoc({ id: 'd', text }, spec)
    for (const c of chunks) assert.equal(text.slice(c.start, c.end), c.text, specName(spec))
    assert.equal(chunks[0]!.start === 0 || text.slice(0, chunks[0]!.start).trim() === '', true)
    assert.equal(chunks.at(-1)!.end >= text.trimEnd().length, true, `${specName(spec)} must reach the end`)
  }
})

test('overlap must be smaller than the window', () => {
  assert.throws(() => chunkDoc({ id: 'd', text: 'x'.repeat(100) }, { kind: 'fixed', size: 50, overlap: 50 }))
})

test('paragraph chunks merge whole paragraphs and respect the limit', () => {
  const text = ['a'.repeat(80), 'b'.repeat(80), 'c'.repeat(80), 'd'.repeat(300)].join('\n')
  const chunks = chunkDoc({ id: 'd', text }, { kind: 'paragraph', maxChars: 200 })
  // a+b fit together (161 chars); c starts a new chunk; the 300-char paragraph is split on its own
  assert.equal(chunks[0]!.text, `${'a'.repeat(80)}\n${'b'.repeat(80)}`)
  assert.equal(chunks[1]!.text, 'c'.repeat(80))
  assert.ok(chunks.slice(2).every((c) => c.text.length <= 200))
  assert.equal(chunks.slice(2).map((c) => c.text).join(''), 'd'.repeat(300))
})

test('chunk ids are unique and stable', () => {
  const chunks = chunkDoc({ id: 'doc', text: longText }, { kind: 'fixed', size: 500, overlap: 50 })
  assert.equal(new Set(chunks.map((c) => c.id)).size, chunks.length)
  assert.equal(chunks[0]!.id, 'doc#0')
})
