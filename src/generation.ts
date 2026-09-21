import { chat } from './ollama.js'
import { normalizeForMatch } from './text.js'
import type { Question } from './types.js'

export const ABSTAIN_TOKEN = 'NO_ENCONTRADO'

export const RAG_SYSTEM_PROMPT = [
  'Eres un asistente que responde preguntas usando SOLO el contexto proporcionado.',
  'Responde en español, de forma breve y directa (una o dos frases).',
  `Si el contexto no contiene la respuesta, responde exactamente: ${ABSTAIN_TOKEN}`,
  'No uses conocimiento externo ni adivines.',
].join('\n')

export function buildContext(passages: string[]): string {
  return passages.map((p, i) => `[${i + 1}] ${p.trim()}`).join('\n\n')
}

export function buildUserPrompt(question: string, passages: string[]): string {
  return `Contexto:\n${buildContext(passages)}\n\nPregunta: ${question}`
}

export function abstained(answer: string): boolean {
  return normalizeForMatch(answer).includes(normalizeForMatch(ABSTAIN_TOKEN))
}

/** Numbers and very short alternatives must match as whole words ("10" must not match "100"); longer
 *  alternatives match as substrings so inflections still count ("matrimonio" matches "matrimonios"). */
function altMatches(normalizedAnswer: string, alt: string): boolean {
  const a = normalizeForMatch(alt)
  if (!a) return false
  const wholeWord = a.length <= 3 || /^[\d ]+$/.test(a)
  return wholeWord ? normalizedAnswer.includes(` ${a} `) : normalizedAnswer.includes(a)
}

/** Deterministic answer check: every key-fact group must be matched by at least one of its alternatives
 *  (accent/case/punctuation-insensitive). No LLM judge involved. */
export function matchesKeyFacts(answer: string, keyFacts: string[][]): boolean {
  const a = ` ${normalizeForMatch(answer)} `
  return keyFacts.every((group) => group.some((alt) => altMatches(a, alt)))
}

export type Condition = 'rag' | 'oracle' | 'closed-book'

export interface GenerationOutcome {
  questionId: string
  answer: string
  abstained: boolean
  /** answerable: key facts all present. unanswerable: correctly abstained. */
  correct: boolean
  promptTokens: number
  completionTokens: number
  ms: number
}

export interface GenerateOptions {
  model: string
  numCtx?: number
  numPredict?: number
  host?: string
}

/** Ask the model one question under one condition and score it. `passages` is empty for closed-book. */
export async function answerQuestion(q: Question, passages: string[], condition: Condition, o: GenerateOptions): Promise<GenerationOutcome> {
  const messages =
    condition === 'closed-book'
      ? [
          { role: 'system' as const, content: 'Responde en español, de forma breve y directa (una o dos frases).' },
          { role: 'user' as const, content: q.question },
        ]
      : [
          { role: 'system' as const, content: RAG_SYSTEM_PROMPT },
          { role: 'user' as const, content: buildUserPrompt(q.question, passages) },
        ]
  const r = await chat(o.model, messages, { num_ctx: o.numCtx ?? 4096, num_predict: o.numPredict ?? 160 }, { host: o.host })
  const didAbstain = abstained(r.content)
  const correct = q.answerable ? !didAbstain && matchesKeyFacts(r.content, q.keyFacts ?? []) : didAbstain
  return {
    questionId: q.id,
    answer: r.content.trim(),
    abstained: didAbstain,
    correct,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    ms: r.totalMs,
  }
}
