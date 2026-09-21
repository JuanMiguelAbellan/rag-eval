import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Bm25Retriever } from '../src/bm25.js'
import { tokenize } from '../src/text.js'
import type { Chunk } from '../src/types.js'

const chunk = (i: number, text: string): Chunk => ({ id: `d#${i}`, docId: 'd', start: 0, end: text.length, text })

test('tokenizer folds accents, drops stopwords and truncates to a stem', () => {
  assert.deepEqual(tokenize('La Revolución Francesa de los Ingleses', { stemPrefix: 6 }), ['revolu', 'france', 'ingles'])
  assert.deepEqual(tokenize('Revolución', { stemPrefix: 0 }), ['revolucion'])
})

test('ranks the chunk that contains the rare query term first', async () => {
  const bm25 = new Bm25Retriever([
    chunk(0, 'El viento mueve las aspas del molino en el campo.'),
    chunk(1, 'La fotosíntesis convierte luz en energía química en los cloroplastos.'),
    chunk(2, 'El molino de viento sirve para moler grano.'),
  ])
  const top = await bm25.retrieve('¿Dónde ocurre la fotosíntesis?', 3)
  assert.equal(top[0]!.index, 1)
  assert.equal(top.length, 1, 'chunks with no query term are not returned')
})

test('accents and inflections do not prevent a match', async () => {
  const bm25 = new Bm25Retriever([chunk(0, 'Los cloroplastos realizan la fotosíntesis.'), chunk(1, 'Otra cosa distinta.')])
  const top = await bm25.retrieve('fotosintesis cloroplasto', 2)
  assert.equal(top[0]!.index, 0)
})

test('a term that appears in every chunk contributes little compared with a rare one', async () => {
  const bm25 = new Bm25Retriever([
    chunk(0, 'energía energía energía común común'),
    chunk(1, 'energía común exclusivo'),
    chunk(2, 'energía común otro'),
  ])
  const top = await bm25.retrieve('energía exclusivo', 3)
  assert.equal(top[0]!.index, 1)
})
