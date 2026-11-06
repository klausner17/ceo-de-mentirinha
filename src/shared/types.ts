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
  /** Título gerado pelo Claude Code (linha ai-title) ou nome do registro de processos. */
  title: string | null
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
  subagents: SubagentState[]
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
