# Fixtures

Transcripts **sintéticos**, montados à mão com a mesma estrutura dos arquivos reais do
Claude Code 2.1.318 (ver `docs/fase-0-formato-dos-transcripts.md`). Nenhum conteúdo real
de prompt, código ou resposta foi copiado: textos foram trocados por `(omitido)`.

Para adicionar fixtures de outra versão, rode `npm run inspect` para ver a estrutura, monte
um trecho anonimizado e nomeie o arquivo com a versão (`session-<versão>-<caso>.jsonl`).
Nunca versione um transcript real.

`session-2.1.321-entregas.jsonl` segue a estrutura do 2.1.321 para as entregas: `toolUseResult`
do Write e do Edit, saída de `git commit` e `gh pr create`, linha `pr-link`, PR por MCP e
artefato publicado. Links e nomes são inventados.
