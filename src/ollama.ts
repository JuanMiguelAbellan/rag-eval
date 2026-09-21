export interface OllamaOptions {
  host?: string
  /** per-request timeout in ms */
  timeoutMs?: number
  retries?: number
}

export class OllamaError extends Error {}

const DEFAULT_HOST = process.env.OLLAMA_HOST?.startsWith('http')
  ? process.env.OLLAMA_HOST
  : `http://${process.env.OLLAMA_HOST ?? '127.0.0.1:11434'}`

async function post<T>(path: string, body: unknown, { host = DEFAULT_HOST, timeoutMs = 300_000, retries = 2 }: OllamaOptions): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${host}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) throw new OllamaError(`Ollama ${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
      return (await res.json()) as T
    } catch (e) {
      lastError = e
      if (e instanceof OllamaError && /HTTP 4\d\d/.test(e.message)) break // client errors won't fix themselves
    }
  }
  const hint = lastError instanceof TypeError ? ` (is Ollama running at ${host}?)` : ''
  throw new OllamaError(`${(lastError as Error)?.message ?? lastError}${hint}`)
}

export async function embed(model: string, input: string[], opts: OllamaOptions = {}): Promise<number[][]> {
  const data = await post<{ embeddings: number[][] }>('/api/embed', { model, input }, opts)
  if (!data.embeddings || data.embeddings.length !== input.length) {
    throw new OllamaError(`Ollama returned ${data.embeddings?.length ?? 0} embeddings for ${input.length} inputs`)
  }
  return data.embeddings
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatResult {
  content: string
  promptTokens: number
  completionTokens: number
  totalMs: number
}

export async function chat(
  model: string,
  messages: ChatMessage[],
  options: Record<string, unknown> = {},
  opts: OllamaOptions = {},
): Promise<ChatResult> {
  const data = await post<any>('/api/chat', { model, messages, stream: false, options: { temperature: 0, seed: 0, ...options } }, opts)
  return {
    content: String(data.message?.content ?? ''),
    promptTokens: Number(data.prompt_eval_count ?? 0),
    completionTokens: Number(data.eval_count ?? 0),
    totalMs: Number(data.total_duration ?? 0) / 1e6,
  }
}
