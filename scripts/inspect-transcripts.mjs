#!/usr/bin/env node
// Fase 0: mostra a ESTRUTURA dos transcripts do Claude Code desta máquina.
// Imprime só nomes de campos, tipos de linha e contagens. Nunca imprime valores
// (prompts, código, respostas), então a saída pode ser colada numa issue.
//
// Uso: npm run inspect [-- --hours 24]

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const root = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
const hoursArg = process.argv.indexOf('--hours')
const hours = hoursArg > -1 ? Number(process.argv[hoursArg + 1]) : 72
const since = Date.now() - hours * 3_600_000

const lineTypes = new Map() // type -> Map<campo, contagem>
const blockTypes = new Map() // `${type}/${bloco}` -> contagem
const usageKeys = new Map()
const versions = new Set()
const models = new Set()
const layout = { sessions: 0, subagentFiles: 0, subagentMeta: 0, legacyAgentFiles: 0, sidechainLinesInParent: 0, metaKeys: new Set() }

const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1)
const fieldsOf = (type) => {
  if (!lineTypes.has(type)) lineTypes.set(type, new Map())
  return lineTypes.get(type)
}

function scanJsonl(path, isParent) {
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    if (!raw.trim()) continue
    let d
    try { d = JSON.parse(raw) } catch { bump(fieldsOf('(json inválido)'), '-'); continue }
    const type = String(d.type ?? '(sem type)')
    const fields = fieldsOf(type)
    for (const k of Object.keys(d)) bump(fields, k)
    if (d.message && typeof d.message === 'object') for (const k of Object.keys(d.message)) bump(fields, `message.${k}`)
    if (Array.isArray(d.message?.content)) for (const b of d.message.content) bump(blockTypes, `${type}/${b?.type}`)
    if (d.message?.usage) for (const k of Object.keys(d.message.usage)) bump(usageKeys, k)
    if (d.version) versions.add(d.version)
    if (d.message?.model) models.add(d.message.model)
    if (isParent && d.isSidechain === true) layout.sidechainLinesInParent++
  }
}

const projects = join(root, 'projects')
if (!existsSync(projects)) {
  console.error(`Não achei ${projects}. Defina CLAUDE_CONFIG_DIR se a pasta for outra.`)
  process.exit(1)
}

for (const dir of readdirSync(projects)) {
  const pdir = join(projects, dir)
  if (!statSync(pdir).isDirectory()) continue
  for (const name of readdirSync(pdir)) {
    const p = join(pdir, name)
    const st = statSync(p)
    if (st.isFile() && name.endsWith('.jsonl') && st.mtimeMs >= since) {
      if (name.startsWith('agent-')) { layout.legacyAgentFiles++; scanJsonl(p, false) }
      else { layout.sessions++; scanJsonl(p, true) }
    }
    const subs = join(p, 'subagents')
    if (st.isDirectory() && existsSync(subs)) {
      for (const s of readdirSync(subs)) {
        const sp = join(subs, s)
        if (statSync(sp).mtimeMs < since) continue
        if (s.endsWith('.meta.json')) {
          layout.subagentMeta++
          try { Object.keys(JSON.parse(readFileSync(sp, 'utf8'))).forEach((k) => layout.metaKeys.add(k)) } catch {}
        } else if (s.endsWith('.jsonl')) { layout.subagentFiles++; scanJsonl(sp, false) }
      }
    }
  }
}

const registry = join(root, 'sessions')
const registryKeys = new Set()
let registryFiles = 0
if (existsSync(registry)) {
  for (const f of readdirSync(registry)) {
    if (!/^\d+\.json$/.test(f)) continue
    registryFiles++
    try { Object.keys(JSON.parse(readFileSync(join(registry, f), 'utf8'))).forEach((k) => registryKeys.add(k)) } catch {}
  }
}

console.log(`# Estrutura dos transcripts em ${root} (últimas ${hours}h)\n`)
console.log(`Versões do Claude Code: ${[...versions].join(', ') || '?'}`)
console.log(`Modelos: ${[...models].join(', ') || '?'}`)
console.log(`Sessões: ${layout.sessions} · subagentes em <sessão>/subagents/: ${layout.subagentFiles} (meta: ${layout.subagentMeta}) · agent-*.jsonl soltos: ${layout.legacyAgentFiles} · linhas sidechain no arquivo do pai: ${layout.sidechainLinesInParent}`)
console.log(`Campos do .meta.json: ${[...layout.metaKeys].join(', ') || '-'}`)
console.log(`Registro de processos (sessions/<pid>.json): ${registryFiles} arquivo(s); campos: ${[...registryKeys].join(', ') || '-'}\n`)
for (const [type, fields] of [...lineTypes].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`## ${type}`)
  console.log([...fields].map(([k, n]) => `${k}(${n})`).join(', '))
  console.log()
}
console.log('## Blocos de conteúdo')
console.log([...blockTypes].map(([k, n]) => `${k}(${n})`).join(', '))
console.log('\n## message.usage')
console.log([...usageKeys].map(([k, n]) => `${k}(${n})`).join(', '))
