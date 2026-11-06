// Faz um personagem andar por uma lista de pontos, um trecho de cada vez, em velocidade
// constante. Usado pelos office boys e pelos liderados junto com a grade de caminhada.

import Phaser from 'phaser'
import type { Point } from '../house'
import type { NavGrid } from '../nav'

type Movable = Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject

export interface WalkOptions {
  scene: Phaser.Scene
  /** Objetos que andam juntos (personagem, etiqueta...), cada um com seu deslocamento. */
  movers: Array<{ obj: Movable; dx?: number; dy?: number }>
  /** Pixels por segundo. */
  speed: number
  /** Chamado no começo de cada trecho, com true se o trecho vai para a esquerda. */
  onLeg?: (left: boolean) => void
  done?: () => void
}

/**
 * O caminho de `from` até `to`: pela grade, se houver, desviando de paredes e móveis;
 * senão pelos pontos de reserva (`fallback`) seguidos do destino.
 */
export function pathTo(nav: NavGrid | null, from: Point, to: Point, fallback: Point[] = []): Point[] {
  return nav?.findPath(from, to) ?? [...fallback, to]
}

export function walkPath(points: Point[], opts: WalkOptions): void {
  const { scene, movers, speed } = opts
  const main = movers[0]!.obj
  scene.tweens.killTweensOf(movers.map((m) => m.obj))
  const step = (i: number): void => {
    const to = points[i]
    if (!to) {
      opts.done?.()
      return
    }
    const duration = Math.max(60, (Math.hypot(to.x - main.x, to.y - main.y) / speed) * 1000)
    opts.onLeg?.(to.x < main.x - 0.5)
    movers.forEach(({ obj, dx = 0, dy = 0 }, k) => {
      scene.tweens.add({
        targets: obj,
        x: to.x + dx,
        y: to.y + dy,
        duration,
        onComplete: k === 0 ? () => step(i + 1) : undefined
      })
    })
  }
  step(0)
}
