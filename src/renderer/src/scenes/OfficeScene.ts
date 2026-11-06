// O escritório: o hall (mapa do Tiled) em cima e, abaixo dele, uma ala por projeto
// com uma mesa por sessão. Role com a roda do mouse ou arraste para andar pelo escritório.

import Phaser from 'phaser'
import type { SessionState } from '@shared/types'
import { createAnimations, personKey, preload, SCALE, TILE, TILES } from '../art'
import { Desk, DESK_H, DESK_W, FONT } from './Desk'

const GAP = 16
const WING_PAD = 16
const WALL = TILE * 2
const DESKS_PER_ROW = 2

export class OfficeScene extends Phaser.Scene {
  private readonly sessions = new Map<string, SessionState>()
  private readonly desks = new Map<string, Desk>()
  private wings: Phaser.GameObjects.GameObject[] = []
  private empty?: Phaser.GameObjects.Text
  private hallHeight = 0
  private door = { x: 0, y: 0 }
  private ready = false

  constructor() {
    super('office')
  }

  preload(): void {
    preload(this)
  }

  create(): void {
    createAnimations(this)
    this.buildHall()
    this.setupCamera()
    this.ready = true
    this.scale.on('resize', () => this.layout())
    this.layout()
  }

  /** O hall vem do mapa do Tiled: parede, porta, estante, fichário, café e sala do CEO. */
  private buildHall(): void {
    const map = this.make.tilemap({ key: 'escritorio' })
    const tileset = map.addTilesetImage('tiles', 'tiles')
    if (!tileset) throw new Error('Tileset "tiles" não encontrado no mapa')
    for (const name of ['chao', 'moveis']) map.createLayer(name, tileset, 0, 0)?.setScale(SCALE).setDepth(0)
    this.hallHeight = map.heightInPixels * SCALE

    const points = map.getObjectLayer('pontos')?.objects ?? []
    const at = (name: string) => {
      const p = points.find((o) => o.name === name)
      return { x: (p?.x ?? 0) * SCALE, y: (p?.y ?? 0) * SCALE }
    }
    this.door = { ...at('porta'), y: at('porta').y + TILE }
    const plate = at('placa-sala-do-ceo')
    this.add.text(plate.x, plate.y, 'Sala do CEO', { fontFamily: FONT, fontSize: '12px', fontStyle: 'bold', color: '#e8c35b' }).setDepth(1)
    // O CEO (você) na própria mesa.
    const ceo = at('sala-do-ceo')
    this.add.sprite(ceo.x, ceo.y + 4, personKey('diretor'), 0).setScale(SCALE).setOrigin(0.5, 1).setDepth(1)
    this.add.image(ceo.x, ceo.y - 4, 'mesa').setScale(SCALE).setOrigin(0.5, 0).setDepth(1)
    this.add
      .text(ceo.x, ceo.y + 38, 'você', { fontFamily: FONT, fontSize: '11px', color: '#1d1f27', backgroundColor: '#e8c35b', padding: { x: 4, y: 1 } })
      .setOrigin(0.5, 0)
      .setDepth(1)
  }

  private setupCamera(): void {
    const cam = this.cameras.main
    this.input.on('wheel', (_p: unknown, _o: unknown, dx: number, dy: number) => {
      cam.scrollX += dx
      cam.scrollY += dy
    })
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom
    })
  }

  setSessions(list: SessionState[]): void {
    this.sessions.clear()
    for (const s of list) this.sessions.set(s.id, s)
    this.layout()
  }

  upsert(s: SessionState): void {
    this.sessions.set(s.id, s)
    this.layout()
  }

  remove(id: string): void {
    this.sessions.delete(id)
    this.layout()
  }

  /** Desenha o chão e a parede de uma ala com os tiles do mapa. */
  private drawWing(x: number, y: number, w: number, h: number, name: string, count: number): void {
    const cols = Math.ceil(w / TILE)
    const floor = this.add.tileSprite(x, y + WALL, cols * TILE, h - WALL, 'tiles-quadros', TILES.carpete).setOrigin(0).setTileScale(SCALE).setDepth(1)
    const wallTop = this.add.tileSprite(x, y, cols * TILE, TILE, 'tiles-quadros', TILES.paredeTopo).setOrigin(0).setTileScale(SCALE).setDepth(1)
    const wall = this.add.tileSprite(x, y + TILE, cols * TILE, TILE, 'tiles-quadros', TILES.parede).setOrigin(0).setTileScale(SCALE).setDepth(1)
    const border = this.add.rectangle(x, y, cols * TILE, h).setOrigin(0).setStrokeStyle(2, 0x1d1f27).setDepth(2)
    const title = this.add
      .text(x + WING_PAD, y + TILE + 6, `Ala ${name}`, { fontFamily: FONT, fontSize: '15px', fontStyle: 'bold', color: '#1d1f27', backgroundColor: '#e8c35b', padding: { x: 6, y: 2 } })
      .setDepth(3)
    const people = this.add
      .text(x + cols * TILE - WING_PAD, y + TILE + 8, `${count} funcionário(s)`, { fontFamily: FONT, fontSize: '12px', color: '#e8e6e3' })
      .setOrigin(1, 0)
      .setDepth(3)
    this.wings.push(floor, wallTop, wall, border, title, people)
  }

  /** Agrupa por projeto, ordena por branch e redistribui alas e mesas. */
  private layout(): void {
    if (!this.ready) return

    for (const [id, desk] of this.desks) {
      if (!this.sessions.has(id)) {
        desk.leave()
        this.desks.delete(id)
      }
    }
    for (const w of this.wings) w.destroy()
    this.wings = []

    const byProject = new Map<string, SessionState[]>()
    for (const s of this.sessions.values()) {
      const key = s.cwd ?? s.project
      const list = byProject.get(key) ?? []
      list.push(s)
      byProject.set(key, list)
    }

    this.empty?.destroy()
    this.empty = undefined
    const top = this.hallHeight + GAP
    if (byProject.size === 0) {
      this.empty = this.add
        .text(this.scale.width / 2, top + 80, 'Escritório vazio.\nAbra uma sessão do Claude Code para contratar alguém.', {
          fontFamily: FONT,
          fontSize: '18px',
          color: '#9aa1b2',
          align: 'center'
        })
        .setOrigin(0.5)
      this.cameras.main.setBounds(0, 0, Math.max(this.scale.width, this.hallHeight * 4), top + 200)
      return
    }

    const wingW = Math.ceil((WING_PAD * 2 + DESKS_PER_ROW * DESK_W + (DESKS_PER_ROW - 1) * GAP) / TILE) * TILE
    const maxWidth = Math.max(this.scale.width, wingW + GAP * 2)
    let x = GAP
    let y = top
    let rowH = 0
    let right = 0

    const projects = [...byProject.entries()].sort(([a], [b]) => a.localeCompare(b))
    for (const [, list] of projects) {
      list.sort((a, b) => (a.branch ?? '').localeCompare(b.branch ?? '') || a.id.localeCompare(b.id))
      const rows = Math.ceil(list.length / DESKS_PER_ROW)
      const wingH = WALL + WING_PAD + rows * DESK_H + (rows - 1) * GAP + WING_PAD

      if (x + wingW > maxWidth && x > GAP) {
        x = GAP
        y += rowH + GAP
        rowH = 0
      }
      this.drawWing(x, y, wingW, wingH, list[0]!.project, list.length)

      list.forEach((s, i) => {
        const dx = x + WING_PAD + (i % DESKS_PER_ROW) * (DESK_W + GAP)
        const dy = y + WALL + WING_PAD + Math.floor(i / DESKS_PER_ROW) * (DESK_H + GAP)
        let desk = this.desks.get(s.id)
        if (!desk) {
          desk = new Desk(this, dx, dy, this.door)
          this.desks.set(s.id, desk)
        }
        desk.moveTo(dx, dy)
        desk.update(s)
      })

      x += wingW + GAP
      right = Math.max(right, x)
      rowH = Math.max(rowH, wingH)
    }
    this.cameras.main.setBounds(0, 0, Math.max(right, this.hallHeight * 4 + GAP), y + rowH + GAP)
  }
}
