/** Nome de ferramenta MCP no Claude Code: mcp__<servidor>__<ferramenta>. */
export function parseMcpTool(name: string): { server: string; tool: string } | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(name)
  return m ? { server: m[1]!, tool: m[2]! } : null
}

/** Nome curto do servidor para a placa: "claude_ai_Google_Drive" vira "Google Drive". */
export function mcpLabel(server: string): string {
  return server.replace(/^claude_ai_/, '').replace(/[_-]+/g, ' ').trim() || server
}
