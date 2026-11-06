// Caixa de entrada do CEO: cada sessão esperando uma resposta vira um email.
// Funções puras, testadas em tests/inbox.test.ts. Quem guarda o que já foi lido é o main.ts.

import type { Awaiting, SessionState } from '@shared/types'
import { cut, sessionTitle } from './describe'

export interface Email {
  /** Identifica o email: muda quando a sessão volta a esperar por outro motivo. */
  key: string
  sessionId: string
  reason: Awaiting['reason']
  since: number
  from: string
  project: string
  subject: string
  unread: boolean
}

export function emailKey(sessionId: string, a: Awaiting): string {
  return `${sessionId}@${a.reason}@${a.since}`
}

/** "Bash" → "Bash"; "mcp__jira__busca" → "jira › busca". */
function toolName(name: string): string {
  if (!name.startsWith('mcp__')) return name
  const [, server = 'MCP', tool] = name.split('__')
  return tool ? `${server} › ${tool}` : server
}

/** Assunto do email, em português. */
export function emailSubject(s: SessionState, a: Awaiting): string {
  switch (a.reason) {
    case 'permissao':
      if (a.detail === 'ExitPlanMode') return 'Aprova o meu plano?'
      return a.detail ? `Posso usar ${toolName(a.detail)}?` : 'Preciso da sua permissão'
    case 'pergunta':
      if (a.detail === 'input needed') return 'Preciso de uma informação sua'
      if (a.detail === 'dialog open') return 'Preciso que você escolha uma opção'
      return a.detail ? `Esperando você: ${a.detail}` : 'Tenho uma pergunta para você'
    case 'relatorio':
      return s.lastPrompt ? `Terminei: “${cut(s.lastPrompt, 50)}”` : 'Terminei o que você pediu'
  }
}

/** Ordem da caixa: pedidos de permissão e perguntas primeiro, depois os mais recentes. */
const URGENCY: Record<Awaiting['reason'], number> = { permissao: 0, pergunta: 0, relatorio: 1 }

/** Os emails de todas as sessões que esperam o CEO. `read` tem as chaves já lidas. */
export function inbox(sessions: Iterable<SessionState>, read: ReadonlySet<string>): Email[] {
  const out: Email[] = []
  for (const s of sessions) {
    const a = s.awaiting
    if (!a) continue
    const key = emailKey(s.id, a)
    out.push({
      key,
      sessionId: s.id,
      reason: a.reason,
      since: a.since,
      from: sessionTitle(s),
      project: s.project,
      subject: emailSubject(s, a),
      unread: !read.has(key)
    })
  }
  return out.sort((a, b) => URGENCY[a.reason] - URGENCY[b.reason] || b.since - a.since)
}

/** Quantos emails não lidos. */
export function unreadCount(emails: Email[]): number {
  return emails.filter((e) => e.unread).length
}
