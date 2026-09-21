import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { OllamaEmbedder } from '../src/embeddings.js'
import { chat, embed, OllamaError } from '../src/ollama.js'
import { fakeOllama } from './helpers.js'

test('embed sends model and inputs and returns one vector per input', async () => {
  const srv = await fakeOllama((_p, body) => ({ json: { embeddings: body.input.map((_: string, i: number) => [i, 1]) } }))
  try {
    const v = await embed('m', ['a', 'b'], { host: srv.url })
    assert.deepEqual(v, [[0, 1], [1, 1]])
    assert.deepEqual(srv.requests[0], { path: '/api/embed', body: { model: 'm', input: ['a', 'b'] } })
  } finally {
    await srv.close()
  }
})

test('embed fails loudly if the server returns the wrong number of vectors', async () => {
  const srv = await fakeOllama(() => ({ json: { embeddings: [[1]] } }))
  try {
    await assert.rejects(embed('m', ['a', 'b'], { host: srv.url, retries: 0 }), /1 embeddings for 2 inputs/)
  } finally {
    await srv.close()
  }
})

test('server errors are retried, client errors are not', async () => {
  const flaky = await fakeOllama((_p, _b, call) => (call < 3 ? { status: 500, json: { error: 'busy' } } : { json: { embeddings: [[1]] } }))
  const bad = await fakeOllama(() => ({ status: 404, json: { error: 'model not found' } }))
  try {
    assert.deepEqual(await embed('m', ['a'], { host: flaky.url, retries: 2 }), [[1]])
    assert.equal(flaky.requests.length, 3)
    await assert.rejects(embed('m', ['a'], { host: bad.url, retries: 2 }), OllamaError)
    assert.equal(bad.requests.length, 1, 'a 404 is not retried')
  } finally {
    await flaky.close()
    await bad.close()
  }
})

test('an unreachable server yields a hint about Ollama not running', async () => {
  await assert.rejects(embed('m', ['a'], { host: 'http://127.0.0.1:1', retries: 0, timeoutMs: 2000 }), /is Ollama running/)
})

test('chat passes deterministic options and reports token counts', async () => {
  const srv = await fakeOllama(() => ({ json: { message: { content: 'hola' }, prompt_eval_count: 12, eval_count: 3, total_duration: 5_000_000 } }))
  try {
    const r = await chat('m', [{ role: 'user', content: 'hi' }], { num_predict: 10 }, { host: srv.url })
    assert.deepEqual(r, { content: 'hola', promptTokens: 12, completionTokens: 3, totalMs: 5 })
    const sent = srv.requests[0]!.body
    assert.equal(sent.stream, false)
    assert.equal(sent.options.temperature, 0)
    assert.equal(sent.options.seed, 0)
    assert.equal(sent.options.num_predict, 10)
  } finally {
    await srv.close()
  }
})

test('the embedder applies task prefixes per kind and never re-embeds cached text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rag-eval-'))
  const srv = await fakeOllama((_p, body) => ({ json: { embeddings: body.input.map((t: string) => [t.length, 1]) } }))
  try {
    const make = () => new OllamaEmbedder({ label: 'x', model: 'nomic', queryPrefix: 'Q: ', documentPrefix: 'D: ', cacheDir: dir, host: srv.url })
    const e = make()
    const [q] = await e.embed(['hola'], 'query')
    const [d] = await e.embed(['hola'], 'document')
    assert.deepEqual(q, [7, 1]) // "Q: hola"
    assert.deepEqual(d, [7, 1]) // "D: hola" — same length, different text: two separate requests
    assert.equal(srv.requests.length, 2)
    assert.deepEqual(srv.requests.map((r) => r.body.input[0]), ['Q: hola', 'D: hola'])

    await e.embed(['hola'], 'query') // memory cache
    await make().embed(['hola'], 'document') // disk cache from a fresh instance
    assert.equal(srv.requests.length, 2, 'no further requests')
  } finally {
    await srv.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('duplicate inputs inside one call are embedded once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rag-eval-'))
  const srv = await fakeOllama((_p, body) => ({ json: { embeddings: body.input.map(() => [1]) } }))
  try {
    const e = new OllamaEmbedder({ label: 'x', model: 'm', cacheDir: dir, host: srv.url })
    const out = await e.embed(['a', 'a', 'b'], 'document')
    assert.equal(out.length, 3)
    assert.deepEqual(srv.requests[0]!.body.input, ['a', 'b'])
  } finally {
    await srv.close()
    await rm(dir, { recursive: true, force: true })
  }
})
