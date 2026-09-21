# Corpus attribution

The 12 texts in this folder are extracts of Spanish Wikipedia articles, used here as a test corpus.
They are © their respective contributors and licensed under the
[Creative Commons Attribution-ShareAlike 4.0 license (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/).
Full edit histories are available on each article's page.

Changes made: plain-text extraction through the MediaWiki API (`prop=extracts&explaintext`), whitespace
normalisation, and truncation to the first ~16,000 characters at a paragraph boundary (see
`scripts/fetch-corpus.ts`). No other edits.

| Article | Source | Revision |
| --- | --- | --- |
| Energía solar | [Energ%C3%ADa_solar](https://es.wikipedia.org/wiki/Energ%C3%ADa_solar) | 174469316 |
| Energía eólica | [Energ%C3%ADa_e%C3%B3lica](https://es.wikipedia.org/wiki/Energ%C3%ADa_e%C3%B3lica) | 175213107 |
| Hidroelectricidad | [Hidroelectricidad](https://es.wikipedia.org/wiki/Hidroelectricidad) | 173783692 |
| Revolución Industrial | [Revoluci%C3%B3n_Industrial](https://es.wikipedia.org/wiki/Revoluci%C3%B3n_Industrial) | 175386279 |
| Revolución francesa | [Revoluci%C3%B3n_francesa](https://es.wikipedia.org/wiki/Revoluci%C3%B3n_francesa) | 174942520 |
| Miguel de Cervantes | [Miguel_de_Cervantes](https://es.wikipedia.org/wiki/Miguel_de_Cervantes) | 175361690 |
| Alan Turing | [Alan_Turing](https://es.wikipedia.org/wiki/Alan_Turing) | 174447606 |
| Fotosíntesis | [Fotos%C3%ADntesis](https://es.wikipedia.org/wiki/Fotos%C3%ADntesis) | 175198350 |
| Sistema inmunitario | [Sistema_inmunitario](https://es.wikipedia.org/wiki/Sistema_inmunitario) | 174403025 |
| Cordillera de los Andes | [Cordillera_de_los_Andes](https://es.wikipedia.org/wiki/Cordillera_de_los_Andes) | 175374082 |
| Machu Picchu | [Machu_Picchu](https://es.wikipedia.org/wiki/Machu_Picchu) | 175078416 |
| Camino de Santiago | [Camino_de_Santiago](https://es.wikipedia.org/wiki/Camino_de_Santiago) | 175401512 |

The rest of this repository (code, questions, results) is MIT-licensed; that licence does **not** cover the
files in `corpus/`, which stay under CC BY-SA 4.0.
