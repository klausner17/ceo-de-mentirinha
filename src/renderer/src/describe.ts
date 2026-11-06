// Frases em português para a plaquinha da mesa e para o painel de detalhes.
// Funções puras: recebem o estado e o horário, devolvem texto. Testadas em tests/describe.test.ts.

import type { SessionState } from '@shared/types'
import { describeTool } from './tools'

const MIN = 60_000
const HOUR = 60 * MIN

/** "agora mesmo", "há 3 min", "há 2 h", "há 2 h 10 min". */
export function ago(at: number, now: number): string {
  const ms = Math.max(0, now - at)
  if (ms < MIN) return 'agora mesmo'
  if (ms < HOUR) return `há ${Math.floor(ms / MIN)} min`
  const h = Math.floor(ms / HOUR)
  const m = Math.floor((ms % HOUR) / MIN)
  return m === 0 || h >= 10 ? `há ${h} h` : `há ${h} h ${m} min`
}

/** 850 → "850", 120_000 → "120 mil", 1_200_000 → "1,2 milhão". */
export function tokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${Math.round(n / 1000)} mil`
  const mi = (n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })
  return `${mi} ${n < 2_000_000 ? 'milhão' : 'milhões'}`
}

/** "claude-opus-5-5" → "Opus 5.5"; "claude-haiku-4-5-20251001" → "Haiku 4.5". */
export function modelName(model: string | null): string {
  if (!model) return 'modelo desconhecido'
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?/.exec(model)
  if (!m) return model
  const family = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1)
  return m[3] ? `${family} ${m[2]}.${m[3]}` : `${family} ${m[2]}`
}

const ROLE: Record<SessionState['seniority'], string> = {
  diretor: 'Diretor',
  pleno: 'Pleno',
  junior: 'Júnior',
  desconhecido: 'Funcionário'
}

/** Corta com reticências. */
export function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** O que a pessoa está fazendo agora, numa frase. */
export function doing(s: SessionState, now: number): string {
  const a = s.awaiting
  if (a?.reason === 'permissao') return `Pedindo sua permissão ${ago(a.since, now)}`
  if (a?.reason === 'pergunta') return `Esperando sua resposta ${ago(a.since, now)}`
  if (s.status === 'ocioso' || a) return `Esperando você ${ago(a?.since ?? s.lastActivity, now)}`
  if (s.currentTool) return `${describeTool(s.currentTool.name).label} ${ago(s.currentTool.startedAt, now)}`
  return 'Pensando…'
}

/**
 * A linha de baixo da plaquinha. Trabalhando: o pedido em que está (o balão já diz a
 * ferramenta). Parado ou esperando o CEO: há quanto tempo espera você.
 */
export function deskLine(s: SessionState, now: number): string {
  if (s.status === 'ocioso' || s.awaiting) return doing(s, now)
  const team = s.subagents.length > 0 ? ` · ${plural(s.subagents.length, 'ajudante', 'ajudantes')}` : ''
  if (s.lastPrompt) return `“${cut(s.lastPrompt, 60)}”${team}`
  return `${s.currentTool ? 'Trabalhando' : 'Pensando…'}${team}`
}

/** Nome da sessão para a plaquinha e para o painel. */
export function sessionTitle(s: SessionState): string {
  return s.title ?? `Sessão ${s.id.slice(0, 8)}`
}

/** Chave do cômodo de uma sessão: a pasta de trabalho (ou o nome do projeto). */
export function roomKey(s: SessionState): string {
  return s.cwd ?? s.project
}

/** Quantas pessoas trabalham num cômodo, em frase. */
export function roomPeople(list: SessionState[]): string {
  const working = list.filter((s) => s.status === 'trabalhando').length
  const total = plural(list.length, 'pessoa', 'pessoas')
  if (working === list.length) return list.length === 1 ? '1 pessoa trabalhando' : `${total} trabalhando`
  if (working === 0) return list.length === 1 ? '1 pessoa esperando' : `${total} esperando`
  return `${working} de ${total} trabalhando`
}

export interface DetailRow {
  label: string
  value: string
}

/** As linhas do painel que abre ao clicar numa mesa. */
export function sessionDetails(s: SessionState, now: number): DetailRow[] {
  const rows: DetailRow[] = []
  const add = (label: string, value: string | null | undefined): void => {
    if (value) rows.push({ label, value })
  }
  add('Agora', doing(s, now))
  add('Último pedido', s.lastPrompt ? cut(s.lastPrompt, 400) : null)
  add('Quem é', `${ROLE[s.seniority]} · ${modelName(s.model)}`)
  add('Projeto', s.project)
  add('Branch', s.branch ?? 'sem branch')
  const pct = Math.round((s.contextTokens / s.contextLimit) * 100)
  add('Contexto', `${tokens(s.contextTokens)} de ${tokens(s.contextLimit)} tokens (${pct}%)`)
  add('Escreveu', `${tokens(s.outputTokens)} tokens`)
  if (s.subagents.length > 0) {
    const team = s.subagents.map((a) => `${a.agentType ?? 'agente'} (${modelName(a.model)})`)
    add('Ajudantes', team.join(', '))
  }
  if (s.mcpCalls.length > 0) {
    const servers = new Map<string, number>()
    for (const c of s.mcpCalls) servers.set(c.server, (servers.get(c.server) ?? 0) + 1)
    add('Office boys na rua', [...servers].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(', '))
  }
  if (s.lastErrorAt !== null) add('Último erro', ago(s.lastErrorAt, now))
  if (s.startedAt) add('Chegou', ago(s.startedAt, now))
  add('Pasta', s.cwd)
  add('Sessão', s.id)
  return rows
}
