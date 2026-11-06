import type { Seniority } from './types'

/** Opus é diretor, Sonnet é pleno, Haiku é júnior. */
export function seniorityFor(model: string | null): Seniority {
  const m = (model ?? '').toLowerCase()
  if (m.includes('opus')) return 'diretor'
  if (m.includes('sonnet')) return 'pleno'
  if (m.includes('haiku')) return 'junior'
  return 'desconhecido'
}
