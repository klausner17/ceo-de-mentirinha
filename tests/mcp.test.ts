import { describe, expect, it } from 'vitest'
import { parseMcpTool } from '../src/shared/mcp'

describe('parseMcpTool', () => {
  it('separa servidor e ferramenta', () => {
    expect(parseMcpTool('mcp__jira__search_issues')).toEqual({ server: 'jira', tool: 'search_issues' })
    expect(parseMcpTool('mcp__claude_ai_Google_Drive__read_file')).toEqual({ server: 'claude_ai_Google_Drive', tool: 'read_file' })
  })
  it('ignora ferramentas que não são MCP', () => {
    expect(parseMcpTool('Bash')).toBeNull()
    expect(parseMcpTool('mcp__sem_ferramenta')).toBeNull()
  })
})
