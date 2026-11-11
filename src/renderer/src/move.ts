// O CEO andando pela casa: anda na direção pedida e escorrega pelas paredes e móveis em vez
// de atravessá-los. Só faz contas sobre a grade de caminhada: não depende do Three.js, para
// dar para testar.

import type { Point } from './house'

/** O que importa da grade de caminhada (NavGrid) para andar. */
export interface Walkable {
  isFree(p: Point): boolean
}

/** Pontos em volta do corpo que precisam estar livres. */
const PROBES = 8

/** Dá para ficar de pé em `p` com um corpo de raio `r` (em pixels do plano)? */
export function canStand(nav: Walkable, p: Point, r: number): boolean {
  if (!nav.isFree(p)) return false
  for (let i = 0; i < PROBES; i++) {
    const a = (i / PROBES) * Math.PI * 2
    if (!nav.isFree({ x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r })) return false
  }
  return true
}

/** Até quantos pixels para o lado o CEO procura um vão quando bate de frente numa quina. */
const ASSIST = 20

/**
 * Anda (dx, dy) a partir de `from`. Bateu numa parede: tenta só na horizontal e só na
 * vertical, para escorregar por ela. Bateu de frente na quina de uma porta: dá um passinho
 * para o lado do vão, para entrar sem precisar mirar. Passos longos são quebrados em
 * pedaços menores que o corpo, para não atravessar parede fina num quadro lento.
 */
export function walk(nav: Walkable, from: Point, dx: number, dy: number, r: number): Point {
  const dist = Math.hypot(dx, dy)
  if (dist === 0) return from
  const pieces = Math.max(1, Math.ceil(dist / (r / 2)))
  const sx = dx / pieces
  const sy = dy / pieces
  let at = from
  for (let i = 0; i < pieces; i++) {
    const both = { x: at.x + sx, y: at.y + sy }
    if (canStand(nav, both, r)) at = both
    else if (sx !== 0 && canStand(nav, { x: at.x + sx, y: at.y }, r)) at = { x: at.x + sx, y: at.y }
    else if (sy !== 0 && canStand(nav, { x: at.x, y: at.y + sy }, r)) at = { x: at.x, y: at.y + sy }
    else {
      const next = sidestep(nav, at, sx, sy, r)
      if (!next) break
      at = next
    }
  }
  return at
}

/** Procura, para os dois lados, um ponto de onde dá para seguir em frente; anda um pouco para lá. */
function sidestep(nav: Walkable, at: Point, sx: number, sy: number, r: number): Point | null {
  const step = Math.hypot(sx, sy)
  // Lado: perpendicular à direção principal.
  const horizontal = Math.abs(sx) >= Math.abs(sy)
  const ahead = horizontal ? { x: Math.sign(sx) * step, y: 0 } : { x: 0, y: Math.sign(sy) * step }
  for (let d = 1; d <= ASSIST; d++) {
    for (const sign of [1, -1]) {
      const off = horizontal ? { x: 0, y: sign * d } : { x: sign * d, y: 0 }
      const side = { x: at.x + off.x, y: at.y + off.y }
      if (!canStand(nav, { x: side.x + ahead.x, y: side.y + ahead.y }, r)) continue
      const move = Math.min(step, d)
      const to = horizontal ? { x: at.x, y: at.y + sign * move } : { x: at.x + sign * move, y: at.y }
      return canStand(nav, to, r) ? to : null
    }
  }
  return null
}

/**
 * Direção de andar no plano da casa a partir das teclas e de para onde a câmera olha.
 * `yaw` 0 é a câmera ao sul olhando para o norte (para cima no plano). Devolve um vetor
 * de tamanho 1 (ou zero, sem tecla).
 */
export function direction(keys: { up: boolean; down: boolean; left: boolean; right: boolean }, yaw: number): Point {
  const forward = (keys.up ? 1 : 0) - (keys.down ? 1 : 0)
  const side = (keys.right ? 1 : 0) - (keys.left ? 1 : 0)
  if (forward === 0 && side === 0) return { x: 0, y: 0 }
  const len = Math.hypot(forward, side)
  const f = forward / len
  const s = side / len
  // Frente: para longe da câmera. Direita: para a direita da tela.
  return {
    x: -Math.sin(yaw) * f + Math.cos(yaw) * s,
    y: -Math.cos(yaw) * f - Math.sin(yaw) * s
  }
}

/** O alvo mais perto de `p`, se estiver a até `max` pixels. */
export function nearest<T extends { at: Point }>(targets: Iterable<T>, p: Point, max: number): T | null {
  let best: T | null = null
  let bestD = max
  for (const t of targets) {
    const d = Math.hypot(t.at.x - p.x, t.at.y - p.y)
    if (d <= bestD) {
      bestD = d
      best = t
    }
  }
  return best
}
