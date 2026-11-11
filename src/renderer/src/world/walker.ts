// Faz um personagem andar por uma lista de pontos do plano em velocidade constante, virado
// para onde vai. Usado pelos office boys e pelos liderados junto com a grade de caminhada.

import * as THREE from 'three'
import type { Point } from '../house'
import type { NavGrid } from '../nav'
import { U } from './kit'

/**
 * O caminho de `from` até `to`: pela grade, se houver, desviando de paredes e móveis;
 * senão pelos pontos de reserva (`fallback`) seguidos do destino.
 */
export function pathTo(nav: NavGrid | null, from: Point, to: Point, fallback: Point[] = []): Point[] {
  return nav?.findPath(from, to) ?? [...fallback, to]
}

/** Vira o objeto (que olha para +z) na direção (dx, dz), girando aos poucos. */
export function turnTowards(obj: THREE.Object3D, dx: number, dz: number, dt: number, rate = 14): void {
  if (Math.abs(dx) + Math.abs(dz) < 1e-6) return
  const target = Math.atan2(dx, dz)
  let diff = target - obj.rotation.y
  diff = Math.atan2(Math.sin(diff), Math.cos(diff))
  obj.rotation.y += diff * Math.min(1, dt * rate)
}

export class Walk {
  private i = 0
  done = false

  constructor(
    private readonly obj: THREE.Object3D,
    private readonly points: Point[],
    /** Pixels do plano por segundo. */
    private readonly speed: number,
    private readonly onDone?: () => void
  ) {
    if (points.length === 0) this.finish()
  }

  private finish(): void {
    if (this.done) return
    this.done = true
    this.onDone?.()
  }

  /** Avança um quadro. */
  update(dt: number): void {
    if (this.done) return
    let budget = this.speed * U * dt
    while (budget > 0 && !this.done) {
      const p = this.points[this.i]!
      const dx = p.x * U - this.obj.position.x
      const dz = p.y * U - this.obj.position.z
      const dist = Math.hypot(dx, dz)
      if (dist > 1e-4) turnTowards(this.obj, dx, dz, dt)
      if (dist <= budget) {
        this.obj.position.x = p.x * U
        this.obj.position.z = p.y * U
        budget -= dist
        this.i++
        if (this.i >= this.points.length) this.finish()
      } else {
        this.obj.position.x += (dx / dist) * budget
        this.obj.position.z += (dz / dist) * budget
        budget = 0
      }
    }
  }
}
