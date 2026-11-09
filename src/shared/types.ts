// Tipos compartilhados entre o processo principal (que lê os arquivos)
// e o renderer (que desenha o escritório). O renderer nunca lê arquivos.

/** Senioridade do funcionário, derivada do modelo. */
export type Seniority = 'diretor' | 'pleno' | 'junior' | 'desconhecido'

/** Estado visível de uma mesa. */
export type DeskStatus = 'trabalhando' | 'ocioso'

/** Ferramenta em uso: o último tool_use que ainda não recebeu tool_result. */
export interface ToolInUse {
  id: string
  name: string
  startedAt: number
}

/** Uma chamada MCP em andamento: o office boy indo à portaria. */
export interface McpCall {
  id: string
  server: string
  tool: string
  startedAt: number
}

/** Uma chamada MCP que acabou há pouco: o office boy voltando. */
export interface McpResult {
  id: string
  server: string
  ok: boolean
  at: number
}

/**
 * Por que a sessão está esperando o CEO (vira um email não lido no computador dele):
 * - `permissao`: pediu permissão para usar uma ferramenta;
 * - `pergunta`: fez uma pergunta ou abriu um diálogo que só a pessoa responde;
 * - `relatorio`: terminou o turno e espera o próximo pedido.
 */
export type AwaitingReason = 'permissao' | 'pergunta' | 'relatorio'

export interface Awaiting {
  reason: AwaitingReason
  /** Desde quando espera. Junto com o id da sessão, identifica o email. */
  since: number
  /** Ferramenta envolvida (permissão) ou o que o Claude Code diz que espera. */
  detail: string | null
}

/** Um pull request que a sessão abriu (por `gh pr create`, por MCP ou pela linha `pr-link`). */
export interface PullRequest {
  number: number
  url: string
  /** "dono/repo", quando dá para saber. */
  repository: string | null
  title: string | null
  at: number
}

/** Um commit feito pela sessão (saída do `git commit` ou commit por MCP). */
export interface Commit {
  /** Hash curto, quando a saída do git mostra. */
  sha: string | null
  message: string
  at: number
}

/** Um arquivo que a sessão criou ou alterou com Write/Edit. */
export interface FileChange {
  path: string
  /** true quando a sessão criou o arquivo (e não só editou). */
  created: boolean
  at: number
}

/** Um artefato publicado (página, doc) com link para abrir. */
export interface PublishedLink {
  url: string
  /** Título do artefato, quando a chamada dizia. */
  title: string | null
  at: number
}

/** Tudo o que a sessão (e seus ajudantes) já entregou. As listas vêm da mais antiga para a mais nova. */
export interface Deliverables {
  prs: PullRequest[]
  commits: Commit[]
  /** Os arquivos mexidos mais recentes (a lista é cortada; ver `filesTotal`). */
  files: FileChange[]
  /** Quantos arquivos diferentes foram mexidos ao todo. */
  filesTotal: number
  /** Quantos desses arquivos foram criados pela sessão. */
  filesCreated: number
  links: PublishedLink[]
}

export interface SubagentState {
  id: string
  /** Tipo do agente, lido do agent-<id>.meta.json quando existe. */
  agentType: string | null
  model: string | null
  currentTool: ToolInUse | null
  lastActivity: number
  /** Horário do último tool_result com erro. */
  lastErrorAt: number | null
  /** true quando o subagente terminou (último turno sem tool call pendente). */
  finished: boolean
}

export interface SessionState {
  id: string
  /** Diretório de trabalho (cwd) da sessão. Vira a ala do escritório. */
  cwd: string | null
  /** Nome curto do projeto (última parte do cwd). */
  project: string
  branch: string | null
  model: string | null
  seniority: Seniority
  /**
   * Nome da sessão como aparece no Claude Code: o que a pessoa deu (/rename), o título
   * gerado, o primeiro pedido ou, por último, o nome derivado da pasta.
   */
  title: string | null
  /** Último pedido digitado pela pessoa nesta sessão. */
  lastPrompt: string | null
  /** Quando a sessão começou (primeira linha do transcript). */
  startedAt: number | null
  /** Tamanho do contexto no último turno: input + cache lido + cache criado. */
  contextTokens: number
  /** Limite de contexto estimado para a pilha de papel (200 mil, ou 1 milhão se já passou disso). */
  contextLimit: number
  /** Tokens de saída acumulados, deduplicados por message.id. */
  outputTokens: number
  /** Tokens lidos do cache acumulados (papel grampeado na gaveta). */
  cacheReadTokens: number
  currentTool: ToolInUse | null
  lastActivity: number
  /** Horário do último tool_result com erro (papel amassado e fumaça). */
  lastErrorAt: number | null
  status: DeskStatus
  /** Chamadas MCP sem resultado ainda (office boys na rua). */
  mcpCalls: McpCall[]
  /** Chamadas MCP que terminaram nos últimos segundos. */
  mcpResults: McpResult[]
  /** true quando o registro em ~/.claude/sessions indica um processo vivo. */
  running: boolean
  /** Esperando uma resposta do CEO, ou null se não precisa dele agora. */
  awaiting: Awaiting | null
  subagents: SubagentState[]
  /** PRs, commits, arquivos e artefatos que a sessão produziu. */
  deliverables: Deliverables
}

/** Mensagens do processo principal para o renderer. */
export type OfficeDelta =
  | { kind: 'snapshot'; sessions: SessionState[] }
  | { kind: 'upsert'; session: SessionState }
  | { kind: 'remove'; id: string }
  | { kind: 'log'; level: 'info' | 'warn' | 'error'; message: string; at: number }

/** API exposta pelo preload em window.office. */
export interface OfficeApi {
  getSnapshot(): Promise<SessionState[]>
  onDelta(listener: (delta: OfficeDelta) => void): () => void
}

export const IPC = {
  snapshot: 'office:snapshot',
  delta: 'office:delta'
} as const
