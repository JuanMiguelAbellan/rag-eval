import { createServer, type IncomingMessage, type Server } from 'node:http'

export interface FakeOllama {
  url: string
  requests: { path: string; body: any }[]
  close(): Promise<void>
}

/** A tiny stand-in for the Ollama HTTP API so tests never need a real model. */
export async function fakeOllama(handler: (path: string, body: any, call: number) => { status?: number; json: unknown }): Promise<FakeOllama> {
  const requests: FakeOllama['requests'] = []
  const server: Server = createServer(async (req: IncomingMessage, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = raw ? JSON.parse(raw) : {}
    requests.push({ path: req.url ?? '', body })
    const { status = 200, json } = handler(req.url ?? '', body, requests.length)
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(json))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as { port: number }
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((r) => server.close(() => r())) }
}
