// Builds ./corpus from Spanish Wikipedia. The text is committed to the repo
// (see corpus/ATTRIBUTION.md) so results stay reproducible even if the live
// articles change — this script only documents how the corpus was made.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Deliberately clustered: three energy articles and two revolution articles
// share a lot of vocabulary, which is what makes retrieval non-trivial.
const ARTICLES: { id: string; title: string }[] = [
  { id: 'energia-solar', title: 'Energía solar' },
  { id: 'energia-eolica', title: 'Energía eólica' },
  { id: 'energia-hidroelectrica', title: 'Energía hidroeléctrica' },
  { id: 'revolucion-industrial', title: 'Revolución industrial' },
  { id: 'revolucion-francesa', title: 'Revolución francesa' },
  { id: 'miguel-de-cervantes', title: 'Miguel de Cervantes' },
  { id: 'alan-turing', title: 'Alan Turing' },
  { id: 'fotosintesis', title: 'Fotosíntesis' },
  { id: 'sistema-inmunitario', title: 'Sistema inmunitario' },
  { id: 'cordillera-de-los-andes', title: 'Cordillera de los Andes' },
  { id: 'machu-picchu', title: 'Machu Picchu' },
  { id: 'camino-de-santiago', title: 'Camino de Santiago' },
]

// Keep the first N characters, cut at a paragraph boundary, so every document
// is a manageable size and the cut is deterministic.
const MAX_CHARS = 16000

const API = 'https://es.wikipedia.org/w/api.php'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchArticle(title: string) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    redirects: '1',
    prop: 'extracts|revisions',
    explaintext: '1',
    exsectionformat: 'plain',
    rvprop: 'ids',
    titles: title,
  })
  let res: Response | undefined
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      res = await fetch(`${API}?${params}`, {
        headers: { 'User-Agent': 'rag-eval/0.1 (corpus builder)' },
        signal: AbortSignal.timeout(20000),
      })
      if (res.status !== 429) break
    } catch {
      // transient network error: fall through to back off and retry
    }
    await sleep(2000 * attempt) // Wikipedia rate-limits bursts: back off and retry
  }
  if (!res || !res.ok) throw new Error(`Wikipedia API ${res?.status} for ${title}`)
  const data = (await res.json()) as any
  const page = Object.values(data.query.pages)[0] as any
  return { text: page.extract as string, revid: page.revisions?.[0]?.revid as number, canonical: page.title as string }
}

function truncateAtParagraph(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.lastIndexOf('\n\n', max)
  return text.slice(0, cut > max * 0.6 ? cut : max).trimEnd()
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

async function main() {
  await mkdir('corpus', { recursive: true })
  // Incremental: articles already in the manifest are not fetched again
  // (set FORCE=1 to rebuild everything).
  let manifest: Record<string, any>[] = []
  if (!process.env.FORCE) {
    try {
      manifest = JSON.parse(await readFile(join('corpus', 'manifest.json'), 'utf8'))
    } catch {
      // no manifest yet
    }
  }
  const done = new Set(manifest.map((m) => m.id))
  for (const a of ARTICLES) {
    if (done.has(a.id)) continue
    const { text, revid, canonical } = await fetchArticle(a.title)
    await sleep(2500)
    const clean = truncateAtParagraph(normalizeWhitespace(text), MAX_CHARS)
    await writeFile(join('corpus', `${a.id}.txt`), clean + '\n', 'utf8')
    manifest.push({
      id: a.id,
      title: canonical,
      url: `https://es.wikipedia.org/wiki/${encodeURIComponent(canonical.replace(/ /g, '_'))}`,
      revision: revid,
      chars: clean.length,
    })
    await writeFile(join('corpus', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
    console.log(`${a.id.padEnd(26)} rev ${revid}  ${clean.length} chars`)
  }
  console.log(`corpus ready: ${manifest.length}/${ARTICLES.length} articles`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
