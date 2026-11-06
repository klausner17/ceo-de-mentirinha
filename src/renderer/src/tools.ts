// Como cada ferramenta aparece na mesa (aba "O que o funcionário está fazendo" do brainstorm).

export interface ToolLook {
  label: string
  color: string
}

const LOOKS: Record<string, ToolLook> = {
  Read: { label: 'Lendo uma pasta', color: '#82aaff' },
  Edit: { label: 'Escrevendo', color: '#c3e88d' },
  MultiEdit: { label: 'Escrevendo', color: '#c3e88d' },
  Write: { label: 'Escrevendo', color: '#c3e88d' },
  NotebookEdit: { label: 'Escrevendo', color: '#c3e88d' },
  Bash: { label: 'No terminal', color: '#f2c66d' },
  WebSearch: { label: 'Na biblioteca', color: '#89ddff' },
  WebFetch: { label: 'Navegando', color: '#89ddff' },
  Grep: { label: 'Vasculhando o arquivo morto', color: '#ffcb6b' },
  Glob: { label: 'Vasculhando o arquivo morto', color: '#ffcb6b' },
  TodoWrite: { label: 'Colando post-its', color: '#ff9cac' },
  TaskCreate: { label: 'Colando post-its', color: '#ff9cac' },
  TaskUpdate: { label: 'Colando post-its', color: '#ff9cac' },
  ExitPlanMode: { label: 'Reunião no quadro branco', color: '#c792ea' },
  Agent: { label: 'Delegando', color: '#7ee787' },
  Task: { label: 'Delegando', color: '#7ee787' }
}

export function describeTool(name: string): ToolLook {
  const look = LOOKS[name]
  if (look) return look
  if (name.startsWith('mcp__')) {
    const server = name.split('__')[1] ?? 'MCP'
    return { label: `Office boy: ${server}`, color: '#f78c6c' }
  }
  return { label: name, color: '#e8e6e3' }
}
