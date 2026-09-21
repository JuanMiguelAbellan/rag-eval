export function foldAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** Lowercase, accent-free, punctuation-free form used for matching answers against key facts. */
export function normalizeForMatch(s: string): string {
  return foldAccents(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

// Small Spanish stopword list — enough to keep BM25 from being dominated by function words.
export const STOPWORDS_ES = new Set(
  (
    'a al algo algunos ante como con contra cual cuando de del desde donde durante e el ella ellas ello ellos en entre era eran es esa esas ese eso esos esta estaba estan este esto estos fue fueron ha han hasta hay la las le les lo los mas me mi muy ni no nos o otra otro para pero por porque que quien se sea segun ser si sido sin sobre son su sus tambien tanto te tiene tienen todo todos tras tu un una uno unos y ya'
  ).split(' '),
)

export interface TokenizeOptions {
  /** Truncate tokens to this many characters — a cheap stand-in for a Spanish stemmer. 0 = off. */
  stemPrefix?: number
}

export function tokenize(text: string, { stemPrefix = 6 }: TokenizeOptions = {}): string[] {
  const out: string[] = []
  for (const raw of normalizeForMatch(text).split(' ')) {
    if (raw.length < 2 || STOPWORDS_ES.has(raw)) continue
    out.push(stemPrefix > 0 ? raw.slice(0, stemPrefix) : raw)
  }
  return out
}
