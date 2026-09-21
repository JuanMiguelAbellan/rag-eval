export interface Doc {
  id: string
  text: string
}

/** A contiguous slice of a document: `doc.text.slice(start, end) === text`. */
export interface Chunk {
  id: string
  docId: string
  start: number
  end: number
  text: string
}

/** Where the answer lives: a verbatim quote from a document. Relevance is defined
 *  against this span, not against any particular chunking, so chunkers can be compared fairly. */
export interface GoldSpan {
  doc: string
  quote: string
}

export interface Question {
  id: string
  question: string
  /** false = the corpus does not contain the answer (the system should abstain). */
  answerable: boolean
  gold?: GoldSpan[]
  /** Key facts a correct answer must contain: every group must match at least one of its alternatives. */
  keyFacts?: string[][]
  /** How the question was phrased relative to the source text. */
  style?: 'lexical' | 'paraphrase'
}

export interface Scored {
  /** index into the retriever's chunk array */
  index: number
  score: number
}

export interface Retriever {
  name: string
  retrieve(query: string, k: number): Promise<Scored[]>
}
