import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadCorpus, loadQuestions, resolveGold, validateDataset } from '../src/dataset.js'
import type { Doc, Question } from '../src/types.js'

const docs: Doc[] = [{ id: 'd', text: 'Uno dos tres.\nCuatro cinco seis.\nCuatro cinco seis dos.' }]
const ok: Question = { id: 'q1', question: '¿?', answerable: true, gold: [{ doc: 'd', quote: 'Uno dos tres.' }], keyFacts: [['uno']] }

test('a well-formed question validates', () => {
  assert.deepEqual(validateDataset([ok], docs).errors, [])
})

test('validation catches a quote that is not verbatim, ambiguous, or in an unknown document', () => {
  const missing = { ...ok, id: 'a', gold: [{ doc: 'd', quote: 'no existe' }] }
  const ambiguous = { ...ok, id: 'b', gold: [{ doc: 'd', quote: 'Cuatro cinco seis' }] }
  const unknown = { ...ok, id: 'c', gold: [{ doc: 'zzz', quote: 'Uno' }] }
  const errors = validateDataset([missing, ambiguous, unknown], docs).errors.join('\n')
  assert.match(errors, /a: gold quote not found verbatim/)
  assert.match(errors, /b: gold quote is ambiguous/)
  assert.match(errors, /c: unknown document/)
})

test('validation catches duplicate ids, missing key facts and gold on unanswerable questions', () => {
  const errors = validateDataset(
    [ok, ok, { ...ok, id: 'nokf', keyFacts: [] }, { id: 'u', question: '¿?', answerable: false, gold: ok.gold }],
    docs,
  ).errors.join('\n')
  assert.match(errors, /q1: duplicate id/)
  assert.match(errors, /nokf: answerable question without key facts/)
  assert.match(errors, /u: unanswerable question must not have gold spans/)
})

test('gold spans resolve to exact character offsets', () => {
  const [span] = resolveGold(ok, new Map(docs.map((d) => [d.id, d])))
  assert.deepEqual(span, { docId: 'd', start: 0, end: 13 })
})

test('the shipped dataset is valid against the shipped corpus', async () => {
  const [corpus, questions] = await Promise.all([loadCorpus(), loadQuestions()])
  const report = validateDataset(questions, corpus)
  assert.deepEqual(report.errors, [])
  assert.ok(report.answerable >= 100)
  assert.ok(report.unanswerable >= 10)
  assert.ok(report.byStyle.lexical! > 5 && report.byStyle.paraphrase! > 5, 'both question styles are represented')
})
