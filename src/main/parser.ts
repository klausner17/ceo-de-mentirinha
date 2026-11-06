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

export interface AssistantEvent extends BaseEvent {
  kind: 'assistant'
  messageId: string | null
  model: string | null
  usage: Usage | null
  toolUses: { id: string; name: string }[]
  stopReason: string | null
}

export interface UserEvent extends BaseEvent {
  kind: 'user'
  toolResults: { toolUseId: string; isError: boolean }[]
}

export interface TitleEvent extends BaseEvent {
  kind: 'title'
  title: string
}

export interface OtherEvent extends BaseEvent {
  kind: 'other'
  type: string | null
}

export type TranscriptEvent = AssistantEvent | UserEvent | TitleEvent | OtherEvent

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
      .map((b) => ({ id: str(b.id) ?? '', name: str(b.name) ?? 'desconhecida' }))
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
    const toolResults = contentBlocks(raw.message)
      .filter((b) => b.type === 'tool_result')
      .map((b) => ({ toolUseId: str(b.tool_use_id) ?? '', isError: b.is_error === true }))
      .filter((t) => t.toolUseId !== '')
    return { ...base, kind: 'user', toolResults }
  }

  if (type === 'ai-title') {
    const title = str(raw.aiTitle)
    if (title) return { ...base, kind: 'title', title }
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
