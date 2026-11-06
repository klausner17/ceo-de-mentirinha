# Fase 0: formato dos transcripts

Inspeção feita em 2026-11-06 com o **Claude Code 2.1.318**, numa máquina Linux (sessão na
nuvem), com `npm run inspect`. O plano pede que a inspeção seja repetida no Mac onde o jogo
vai rodar: rode `npm run inspect -- --hours 72` e compare com esta página antes de confiar
no parser para versões diferentes.

## Campos da tabela de mapeamento

| Sinal | Campo esperado no plano | Situação em 2.1.318 |
| --- | --- | --- |
| Sessão ativa | transcript alterado ou registro em `sessions/` | Confirmado. `~/.claude/sessions/<pid>.json` existe e tem `sessionId`, `cwd`, `name` e `status` (`"busy"` durante um turno). |
| Projeto | `cwd` das linhas | Confirmado em `user`, `assistant` e `attachment`. |
| Branch | `gitBranch` das linhas | Confirmado nos mesmos tipos de linha. |
| Modelo | `message.model` | Confirmado em `assistant` (ex.: `claude-opus-5-5`). Há também `requestedModel` na linha. |
| Tokens | `message.usage`, deduplicado por `message.id` | Confirmado. Uma resposta virou até 3 linhas com o mesmo `message.id` e o mesmo `usage`. A deduplicação é necessária. |
| Ferramenta em uso | `tool_use` sem `tool_result` | Confirmado. `tool_use` tem `id`, `name`, `input`, `caller`; `tool_result` (em linhas `user`) tem `tool_use_id` e às vezes `is_error`. |
| Subagente | `<sessão>/subagents/agent-<id>.jsonl` + `.meta.json` | **Não verificado**: nenhuma sessão inspecionada lançou subagentes. A pasta `<sessão>/` existe ao lado do `.jsonl` (com `ccr-tip.json`), o que é coerente com o plano. O parser aceita os dois formatos (pasta `subagents/` e `agent-*.jsonl` solto) e o `.meta.json` lido procura `agentType`. |
| Ocioso | nenhuma escrita há N minutos | Não existe sinal explícito no transcript; usamos tempo desde a última escrita (padrão 5 min, `CEO_IDLE_MINUTES`). O `status` do registro de processos pode ajudar, mas só vimos o valor `busy`. |

## Tipos de linha encontrados

| `type` | Uso no jogo |
| --- | --- |
| `assistant` | modelo, tokens, `tool_use`, `stop_reason` |
| `user` | prompts (primeiro e último pedido, fora `isMeta` e comandos `<...>`) e `tool_result` |
| `attachment` | só atualiza horário, `cwd` e branch |
| `custom-title` | nome dado pela pessoa com `/rename` (`customTitle`); é o nome preferido da mesa (visto no binário do 2.1.319) |
| `agent-name` | nome de agente/colega de equipe (`agentName`) |
| `ai-title` | título curto da sessão (`aiTitle`), usado como nome na mesa quando não há nome dado |
| `summary` | resumo (`summary`) de versões antigas; último recurso antes do primeiro pedido |
| `tools-used`, `last-prompt`, `queue-operation`, `atis-latch` | ignorados por enquanto |

Campos que não estavam no plano e podem ser úteis depois: `permissionMode` (linhas `user`,
para o "regime de trabalho"), `toolUseResult` e `permissionDecision` (resultado e decisão
de permissão de cada ferramenta), `effort`.

## O que ainda falta validar

- Onde ficam os subagentes nesta versão, com uma sessão real que use a ferramenta Agent.
- Valores do `status` no registro de processos além de `busy`.
- Se o registro em `sessions/` é apagado quando a sessão fecha normalmente no macOS. O jogo
  também confere se o `pid` ainda existe, para não deixar mesa de processo morto.

## Nome da sessão (2.1.319)

O registro em `sessions/<pid>.json` tem `name` e `nameSource`. Com `nameSource: "derived"` o
nome é só a pasta com um número (ex.: `ceo-de-mentirinha-29`), e por isso fica por último.
Ordem usada pelo jogo (`sessionName` em `src/main/office-store.ts`): `custom-title`, nome do
registro com `nameSource` `user`/`peer`/`hook`, `agent-name`, `ai-title`, `summary`, nome do
registro com `nameSource: "auto"`, primeiro pedido digitado e, por fim, o nome derivado.
