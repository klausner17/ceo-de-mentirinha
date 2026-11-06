# CEO de Mentirinha

App Electron + Phaser que mostra as sessões do Claude Code como funcionários num escritório.
Textos, comentários e docs em português.

- Antes de commitar: `npm run typecheck && npm test && npm run build`.
- `src/main/parser.ts` é o único lugar que conhece nomes de campos dos transcripts. Linhas
  desconhecidas nunca devem lançar erro.
- O renderer nunca lê arquivos; tudo chega por `window.office` (preload).
- Nunca versionar transcripts reais. Fixtures novos são sintéticos e levam a versão do
  Claude Code no nome.
- A v1 é somente leitura: não escrever em `~/.claude` nem mexer no `settings.json` do usuário.
