import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { IncrementalReader } from '../src/main/incremental-reader'

describe('IncrementalReader', () => {
  const file = () => join(mkdtempSync(join(tmpdir(), 'ceo-')), 's.jsonl')

  it('lê só as linhas novas e guarda a linha incompleta para depois', async () => {
    const path = file()
    const r = new IncrementalReader()
    writeFileSync(path, '{"a":1}\n{"b":')
    expect(await r.readNewLines(path)).toEqual(['{"a":1}'])
    appendFileSync(path, '2}\n{"c":3}\n')
    expect(await r.readNewLines(path)).toEqual(['{"b":2}', '{"c":3}'])
    expect(await r.readNewLines(path)).toEqual([])
  })

  it('não corta caracteres multibyte entre leituras', async () => {
    const path = file()
    const r = new IncrementalReader()
    const text = '{"t":"ação"}\n'
    const bytes = Buffer.from(text)
    writeFileSync(path, bytes.subarray(0, 9)) // no meio do "ç"
    expect(await r.readNewLines(path)).toEqual([])
    appendFileSync(path, bytes.subarray(9))
    expect(await r.readNewLines(path)).toEqual(['{"t":"ação"}'])
  })

  it('recomeça do zero quando o arquivo é truncado', async () => {
    const path = file()
    const r = new IncrementalReader()
    writeFileSync(path, '{"a":1}\n{"b":2}\n')
    await r.readNewLines(path)
    writeFileSync(path, '{"z":9}\n')
    expect(await r.readNewLines(path)).toEqual(['{"z":9}'])
  })

  it('leituras simultâneas do mesmo arquivo não duplicam linhas', async () => {
    const path = file()
    const r = new IncrementalReader()
    writeFileSync(path, '{"a":1}\n')
    const [x, y] = await Promise.all([r.readNewLines(path), r.readNewLines(path)])
    expect([...x, ...y]).toEqual(['{"a":1}'])
  })
})
