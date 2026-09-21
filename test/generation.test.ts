import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ABSTAIN_TOKEN, abstained, answerQuestion, buildContext, matchesKeyFacts } from '../src/generation.js'
import type { Question } from '../src/types.js'
import { fakeOllama } from './helpers.js'

test('key facts: every group must match, any alternative inside a group', () => {
  const kf = [['1769'], ['watt', 'james watt']]
  assert.equal(matchesKeyFacts('La patentó James Watt en 1769.', kf), true)
  assert.equal(matchesKeyFacts('La patentó Watt.', kf), false)
})

test('key facts ignore case, accents and punctuation', () => {
  assert.equal(matchesKeyFacts('Fue en el SIGLO XII, en Francia.', [['siglo xii']]), true)
  assert.equal(matchesKeyFacts('Pachacútec', [['pachacutec']]), true)
  assert.equal(matchesKeyFacts('El 0,08 % de la energía', [['0 08']]), true)
})

test('numbers must match as whole tokens, words match as substrings', () => {
  assert.equal(matchesKeyFacts('Unos 100 metros', [['10']]), false, '"10" must not match inside "100"')
  assert.equal(matchesKeyFacts('Cuenta con 172 edificios', [['172']]), true)
  assert.equal(matchesKeyFacts('mediante matrimonios ventajosos', [['matrimonio']]), true, 'inflected form still counts')
})

test('abstention is detected however the model formats it', () => {
  assert.equal(abstained(ABSTAIN_TOKEN), true)
  assert.equal(abstained('  no_encontrado.'), true)
  assert.equal(abstained('La respuesta es 42.'), false)
})

test('context is numbered so the model can tell passages apart', () => {
  assert.equal(buildContext(['uno', ' dos ']), '[1] uno\n\n[2] dos')
})

const answerable: Question = { id: 'q1', question: '¿Año?', answerable: true, keyFacts: [['1769']] }
const unanswerable: Question = { id: 'u1', question: '¿Algo?', answerable: false }

test('scoring: answerable is correct only with the key facts and without abstaining', async () => {
  const srv = await fakeOllama((_p, body) => ({
    json: { message: { content: body.messages[1].content.includes('SIN_DATOS') ? ABSTAIN_TOKEN : 'En 1769.' }, prompt_eval_count: 1, eval_count: 1, total_duration: 1e6 },
  }))
  try {
    const good = await answerQuestion(answerable, ['pasaje'], 'rag', { model: 'm', host: srv.url })
    assert.equal(good.correct, true)
    const refused = await answerQuestion(answerable, ['SIN_DATOS'], 'rag', { model: 'm', host: srv.url })
    assert.equal(refused.correct, false)
    assert.equal(refused.abstained, true)
  } finally {
    await srv.close()
  }
})

test('scoring: unanswerable is correct only when the model abstains', async () => {
  const srv = await fakeOllama((_p, body) => ({ json: { message: { content: body.messages[1].content.includes('SIN_DATOS') ? ABSTAIN_TOKEN : 'Inventado.' } } }))
  try {
    assert.equal((await answerQuestion(unanswerable, ['SIN_DATOS'], 'rag', { model: 'm', host: srv.url })).correct, true)
    assert.equal((await answerQuestion(unanswerable, ['otra cosa'], 'rag', { model: 'm', host: srv.url })).correct, false)
  } finally {
    await srv.close()
  }
})

test('closed-book sends no context and no abstention instruction', async () => {
  const srv = await fakeOllama(() => ({ json: { message: { content: '1769' } } }))
  try {
    await answerQuestion(answerable, [], 'closed-book', { model: 'm', host: srv.url })
    const [sys, user] = srv.requests[0]!.body.messages
    assert.equal(user.content, '¿Año?')
    assert.ok(!sys.content.includes(ABSTAIN_TOKEN))
  } finally {
    await srv.close()
  }
})
