// Converte uma linha de transcript (.jsonl) em um evento tipado.
//
// O formato dos transcripts não é uma API estável. Este é o ÚNICO módulo que
// conhece os nomes dos campos; tudo o que não reconhecemos vira `other` ou é
// ignorado, sem lançar erro. Ver docs/fase-0-formato-dos-transcripts.md.

export interface Usage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

interface BaseEvent {
  sessionId: string | null
  cwd: string | null
  branch: string | null
  /** Epoch em ms, ou null se a linha não tiver timestamp. */
  timestamp: number | null
  /** Linha de subagente (sidechain). */
  isSidechain: boolean
}

/**
 * Os poucos campos do `input` de uma ferramenta que o jogo usa para achar entregas
 * (PR, commit, arquivo, artefato). Os demais campos são ignorados.
 */
export interface ToolInput {
  /** Bash: o comando. */
  command: string | null
  /** Write/Edit/MultiEdit (`file_path`) e NotebookEdit (`notebook_path`). */
  filePath: string | null
  /** Título do PR (MCP) ou do artefato. */
  title: string | null
  /** Mensagem de commit em ferramentas MCP (`message`, `commit_message`). */
  message: string | null
  /** Ação de ferramentas com vários modos, como a de artefatos (`publish`, `read`…). */
  action: string | null
}

export interface ToolUse {
  id: string
  name: string
  input: ToolInput
}

export interface AssistantEvent extends BaseEvent {
  kind: 'assistant'
  messageId: string | null
  model: string | null
  usage: Usage | null
  toolUses: ToolUse[]
  stopReason: string | null
}

export interface ToolResult {
  toolUseId: string
  isError: boolean
  /** Começo do texto do resultado (para achar links de PR e o hash do commit). */
  text: string | null
  /** Write: `create` quando o arquivo foi criado, `update` quando já existia. */
  fileOp: 'create' | 'update' | null
}

export interface UserEvent extends BaseEvent {
  kind: 'user'
  toolResults: ToolResult[]
  /** Texto digitado pela pessoa (null em resultados de ferramenta, comandos e linhas internas). */
  prompt: string | null
}

/**
 * De onde veio o nome da sessão:
 * - `custom`: a pessoa renomeou a sessão (/rename), linha `custom-title`;
 * - `agent`: nome de agente/colega de equipe, linha `agent-name`;
 * - `ai`: título curto gerado pelo Claude Code, linha `ai-title`;
 * - `summary`: resumo de versões antigas, linha `summary`.
 */
export type TitleSource = 'custom' | 'agent' | 'ai' | 'summary'

export interface TitleEvent extends BaseEvent {
  kind: 'title'
  title: string
  source: TitleSource
}

/** Linha `pr-link`: o Claude Code ligou a sessão a um PR (gravada depois de `gh pr create`). */
export interface PrLinkEvent extends BaseEvent {
  kind: 'pr-link'
  number: number
  url: string
  repository: string | null
}

export interface OtherEvent extends BaseEvent {
  kind: 'other'
  type: string | null
}

export type TranscriptEvent = AssistantEvent | UserEvent | TitleEvent | PrLinkEvent | OtherEvent

type Json = Record<string, unknown>

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

function parseTimestamp(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (typeof v !== 'string') return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

function parseUsage(v: unknown): Usage | null {
  if (!isObj(v)) return null
  return {
    inputTokens: num(v.input_tokens),
    outputTokens: num(v.output_tokens),
    cacheReadTokens: num(v.cache_read_input_tokens),
    cacheCreationTokens: num(v.cache_creation_input_tokens)
  }
}

function contentBlocks(message: unknown): Json[] {
  if (!isObj(message) || !Array.isArray(message.content)) return []
  return message.content.filter(isObj)
}

/**
 * Texto de um prompt da pessoa: `content` em string ou blocos `text`. Comandos e avisos
 * internos (que começam com `<`, como `<command-name>`) não contam como pedido.
 */
function promptText(message: unknown): string | null {
  if (!isObj(message)) return null
  const c = message.content
  const text =
    typeof c === 'string'
      ? c
      : contentBlocks(message)
          .filter((b) => b.type === 'text')
          .map((b) => str(b.text) ?? '')
          .join('\n')
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean === '' || clean.startsWith('<') || clean.startsWith('[Request interrupted')) return null
  return clean
}

/** Tamanho máximo do texto de resultado guardado: links e hashes aparecem no começo. */
const RESULT_TEXT_MAX = 8000

function toolInput(v: unknown): ToolInput {
  const i = isObj(v) ? v : {}
  return {
    command: str(i.command),
    filePath: str(i.file_path) ?? str(i.notebook_path),
    title: str(i.title),
    message: str(i.message) ?? str(i.commit_message),
    action: str(i.action)
  }
}

/** Texto de um tool_result: `content` em string ou blocos `text`. */
function resultText(block: Json): string | null {
  const c = block.content
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(isObj).map((b) => (b.type === 'text' ? (str(b.text) ?? '') : '')).join('\n') : ''
  return text === '' ? null : text.slice(0, RESULT_TEXT_MAX)
}

/** Interpreta um objeto já decodificado. Retorna null se não for um objeto. */
export function parseRecord(raw: unknown): TranscriptEvent | null {
  if (!isObj(raw)) return null
  const base: BaseEvent = {
    sessionId: str(raw.sessionId),
    cwd: str(raw.cwd),
    branch: str(raw.gitBranch),
    timestamp: parseTimestamp(raw.timestamp),
    isSidechain: raw.isSidechain === true
  }
  const type = str(raw.type)

  if (type === 'assistant') {
    const message = isObj(raw.message) ? raw.message : {}
    const toolUses = contentBlocks(message)
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({ id: str(b.id) ?? '', name: str(b.name) ?? 'desconhecida', input: toolInput(b.input) }))
      .filter((t) => t.id !== '')
    return {
      ...base,
      kind: 'assistant',
      messageId: str(message.id),
      model: str(message.model),
      usage: parseUsage(message.usage),
      toolUses,
      stopReason: str(message.stop_reason)
    }
  }

  if (type === 'user') {
    // `toolUseResult` descreve o resultado da (única) ferramenta da linha; no Write, `type` diz se criou o arquivo.
    const tur = isObj(raw.toolUseResult) ? raw.toolUseResult : null
    const op = tur && (tur.type === 'create' || tur.type === 'update') ? tur.type : null
    const blocks = contentBlocks(raw.message).filter((b) => b.type === 'tool_result')
    const toolResults = blocks
      .map((b) => ({
        toolUseId: str(b.tool_use_id) ?? '',
        isError: b.is_error === true,
        text: resultText(b),
        fileOp: blocks.length === 1 ? (op as ToolResult['fileOp']) : null
      }))
      .filter((t) => t.toolUseId !== '')
    const prompt = toolResults.length === 0 && raw.isMeta !== true ? promptText(raw.message) : null
    return { ...base, kind: 'user', toolResults, prompt }
  }

  if (type === 'pr-link') {
    const url = str(raw.prUrl)
    const n = typeof raw.prNumber === 'number' ? raw.prNumber : Number(raw.prNumber)
    if (url && Number.isInteger(n) && n > 0) return { ...base, kind: 'pr-link', number: n, url, repository: str(raw.prRepository) }
  }

  const titleField: Record<string, [string, TitleSource]> = {
    'custom-title': ['customTitle', 'custom'],
    'agent-name': ['agentName', 'agent'],
    'ai-title': ['aiTitle', 'ai'],
    summary: ['summary', 'summary']
  }
  const titleOf = type ? titleField[type] : undefined
  if (titleOf) {
    const title = str(raw[titleOf[0]])?.trim()
    if (title) return { ...base, kind: 'title', title, source: titleOf[1] }
  }

  return { ...base, kind: 'other', type }
}

/** Interpreta uma linha de texto. JSON inválido retorna null (nunca lança). */
export function parseLine(line: string): TranscriptEvent | null {
  const trimmed = line.trim()
  if (trimmed === '') return null
  try {
    return parseRecord(JSON.parse(trimmed))
  } catch {
    return null
  }
}
