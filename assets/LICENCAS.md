# Licenças dos assets

Toda a arte deste repositório é original e foi desenhada como texto em
`scripts/gerar-arte.mjs`, que gera os PNGs e o mapa. Ela segue a licença do projeto (MIT).
Nenhum pacote de terceiros é usado.

| Arquivo | Origem | Licença |
| --- | --- | --- |
| `sprites/funcionario-*.png` | `scripts/gerar-arte.mjs` | MIT, como o projeto |
| `sprites/mesa.png`, `sprites/monitor.png`, `sprites/itens.png` | `scripts/gerar-arte.mjs` | MIT, como o projeto |
| `sprites/tiles.png` | `scripts/gerar-arte.mjs` | MIT, como o projeto |
| `mapa/escritorio.json` | `scripts/gerar-arte.mjs`, no formato JSON do [Tiled](https://www.mapeditor.org/) | MIT, como o projeto |

O mapa abre no Tiled. Se você editar o mapa no Tiled, o `npm run arte` sobrescreve as
mudanças. Nesse caso, passe a editar só o JSON pelo Tiled e tire o mapa do script.

Para adicionar um pacote de terceiros, inclua uma linha com autor, licença e link, e
confira se a licença permite redistribuição.
