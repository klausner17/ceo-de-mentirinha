// Como cada ferramenta aparece na mesa (aba "O que o funcionário está fazendo" do brainstorm).

import type { Pose, Screen } from './art'

export interface ToolLook {
  label: string
  color: string
  pose: Pose
  screen: Screen
  /** Post-its na mesa (lista de TODOs). */
  postits?: boolean
}

const write = { label: 'Escrevendo', color: '#c3e88d', pose: 'digitando', screen: 'codigo' } as const
const search = { label: 'Vasculhando o arquivo morto', color: '#ffcb6b', pose: 'procurando', screen: 'codigo' } as const
const todo = { label: 'Colando post-its', color: '#ff9cac', pose: 'digitando', screen: 'codigo', postits: true } as const
const delegate = { label: 'Delegando', color: '#7ee787', pose: 'apontando', screen: 'codigo' } as const

const LOOKS: Record<string, ToolLook> = {
  Read: { label: 'Lendo uma pasta', color: '#82aaff', pose: 'lendo', screen: 'codigo' },
  Edit: write,
  MultiEdit: write,
  Write: write,
  NotebookEdit: write,
  Bash: { label: 'No terminal', color: '#f2c66d', pose: 'digitando', screen: 'terminal' },
  WebSearch: { label: 'Na biblioteca', color: '#89ddff', pose: 'lendo', screen: 'navegador' },
  WebFetch: { label: 'Navegando', color: '#89ddff', pose: 'lendo', screen: 'navegador' },
  Grep: search,
  Glob: search,
  TodoWrite: todo,
  TaskCreate: todo,
  TaskUpdate: todo,
  ExitPlanMode: { label: 'Reunião no quadro branco', color: '#c792ea', pose: 'apontando', screen: 'navegador' },
  Agent: delegate,
  Task: delegate
}

export function describeTool(name: string): ToolLook {
  const look = LOOKS[name]
  if (look) return look
  if (name.startsWith('mcp__')) {
    const server = name.split('__')[1] ?? 'MCP'
    return { label: `Office boy: ${server}`, color: '#f78c6c', pose: 'digitando', screen: 'navegador' }
  }
  return { label: name, color: '#e8e6e3', pose: 'digitando', screen: 'codigo' }
}
