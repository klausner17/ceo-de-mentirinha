import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const SESSION = '11111111-2222-4333-8444-555555555555'
export const fixture = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8')
export const lines = (name: string) => fixture(name).split('\n').filter((l) => l.trim() !== '')
/** Horário logo depois das linhas dos fixtures (2026-11-06T14:00:xx). */
export const T0 = Date.parse('2026-11-06T14:00:00.000Z')
