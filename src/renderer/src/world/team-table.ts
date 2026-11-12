// A mesa da equipe de um cômodo: um tampo comprido com cadeiras dos dois lados, onde os
// liderados de todas as mesas do projeto sentam para trabalhar. Ela guarda quem está em qual
// lugar; com as cadeiras cheias, os próximos ficam de pé nas pontas.

import * as THREE from 'three'
import { TEAM, teamSpots, type Point, type Spot } from '../house'
import { box, dispose, mat, U } from './kit'

/** Os liderados são menores que os funcionários (ver desk.ts); a mobília acompanha. */
const SMALL = 0.75
const TABLE_H = 0.62 * SMALL

export class TeamTable {
  readonly root = new THREE.Group()
  private center: Point
  private spots: Spot[]
  /** Quem está em cada lugar (id do subagente), na ordem de teamSpots. */
  private readonly taken: Array<string | null>
  /** Notebook na frente de cada cadeira: aparece quando alguém senta. */
  private readonly laptops: THREE.Group[] = []

  constructor(center: Point) {
    this.center = center
    this.spots = teamSpots(center)
    this.taken = this.spots.map(() => null)
    this.root.position.set(center.x * U, 0, center.y * U)

    const wood = mat('#c9a06b')
    const woodDark = mat('#7a5232')
    this.root.add(box(TEAM.w * U, 0.06, TEAM.d * U, wood, [0, TABLE_H, 0]))
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
      this.root.add(box(0.07, TABLE_H, 0.07, woodDark, [dx * (TEAM.w / 2 - 6) * U, TABLE_H / 2, dz * (TEAM.d / 2 - 5) * U]))
    }
    // Um vasinho no meio da mesa.
    this.root.add(box(0.12, 0.1, 0.12, mat('#b5643c'), [0, TABLE_H + 0.08, 0]))
    this.root.add(box(0.16, 0.12, 0.16, mat('#4caf50'), [0, TABLE_H + 0.19, 0]))

    this.spots.forEach((s) => {
      if (!s.sit) return
      const side = Math.sign(s.y - center.y)
      // Cadeira com o encosto do lado de fora, um pouco atrás de onde a pessoa fica.
      const chair = new THREE.Group()
      chair.position.set((s.x - center.x) * U, 0, (s.y - center.y + side * 3) * U)
      if (side > 0) chair.rotation.y = Math.PI
      chair.scale.setScalar(SMALL)
      chair.add(box(0.5, 0.07, 0.48, mat('#3a3f4d'), [0, 0.38, 0]))
      chair.add(box(0.5, 0.5, 0.07, mat('#3a3f4d'), [0, 0.68, -0.24]))
      chair.add(box(0.06, 0.35, 0.06, mat('#2c2f3a'), [0, 0.18, 0]))
      chair.add(box(0.4, 0.04, 0.4, mat('#2c2f3a'), [0, 0.02, 0]))
      this.root.add(chair)

      // Notebook aberto, com a tela virada para a cadeira.
      const laptop = new THREE.Group()
      laptop.position.set((s.x - center.x) * U, TABLE_H + 0.035, side * (TEAM.d / 2 - 11) * U)
      if (side > 0) laptop.rotation.y = Math.PI
      laptop.add(box(0.34, 0.015, 0.22, mat('#9aa0ab'), [0, 0, 0]))
      // A tampa gira na dobradiça do lado de longe e inclina um pouco para trás.
      const lid = new THREE.Group()
      lid.position.set(0, 0, 0.11)
      lid.rotation.x = 0.25
      lid.add(box(0.34, 0.22, 0.015, mat('#2c2f3a'), [0, 0.11, 0]))
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.18), new THREE.MeshBasicMaterial({ color: '#7ee0ff' }))
      screen.position.set(0, 0.11, -0.009)
      screen.rotation.y = Math.PI
      lid.add(screen)
      laptop.add(lid)
      laptop.visible = false
      this.laptops.push(laptop)
      this.root.add(laptop)
    })
  }

  /** O cômodo mudou de lugar na casa. Devolve true se a mesa andou. */
  moveTo(center: Point): boolean {
    if (center.x === this.center.x && center.y === this.center.y) return false
    this.center = center
    this.spots = teamSpots(center)
    this.root.position.set(center.x * U, 0, center.y * U)
    return true
  }

  /** Reserva o primeiro lugar livre para o subagente (ou devolve o que ele já tem). */
  claim(id: string): number | null {
    const mine = this.taken.indexOf(id)
    if (mine >= 0) return mine
    const free = this.taken.indexOf(null)
    if (free < 0) return null
    this.taken[free] = id
    return free
  }

  release(id: string): void {
    const i = this.taken.indexOf(id)
    if (i < 0) return
    this.taken[i] = null
    this.setSeated(i, false)
  }

  spot(i: number): Spot {
    return this.spots[i]!
  }

  /** Mostra o notebook na frente da cadeira enquanto alguém está sentado nela. */
  setSeated(i: number, seated: boolean): void {
    const laptop = this.laptops[i]
    if (laptop) laptop.visible = seated
  }

  dispose(): void {
    dispose(this.root)
  }
}
