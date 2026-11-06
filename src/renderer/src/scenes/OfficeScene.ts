// O escritório: uma ala por projeto, uma mesa por sessão.
// Fase 3 do plano: formas simples. A arte real entra na fase 6.

import Phaser from 'phaser'
import type { SessionState } from '@shared/types'
import { Desk, DESK_H, DESK_W, FONT } from './Desk'

const GAP = 16
const WING_PAD = 16
const WING_HEADER = 34
const DESKS_PER_ROW = 2

export class OfficeScene extends Phaser.Scene {
  private readonly sessions = new Map<string, SessionState>()
  private readonly desks = new Map<string, Desk>()
  private wings: Phaser.GameObjects.GameObject[] = []
  private empty?: Phaser.GameObjects.Text
  private ready = false

  constructor() {
    super('office')
  }

  create(): void {
    this.ready = true
    this.scale.on('resize', () => this.layout())
    this.layout()
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

  /** Agrupa por projeto, ordena por branch e redistribui mesas e alas. */
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
    if (byProject.size === 0) {
      this.empty = this.add
        .text(this.scale.width / 2, this.scale.height / 2, 'Escritório vazio.\nAbra uma sessão do Claude Code para contratar alguém.', {
          fontFamily: FONT,
          fontSize: '18px',
          color: '#7d8590',
          align: 'center'
        })
        .setOrigin(0.5)
      return
    }

    const wingW = WING_PAD * 2 + DESKS_PER_ROW * DESK_W + (DESKS_PER_ROW - 1) * GAP
    let x = GAP
    let y = GAP
    let rowH = 0

    const projects = [...byProject.entries()].sort(([a], [b]) => a.localeCompare(b))
    for (const [, list] of projects) {
      list.sort((a, b) => (a.branch ?? '').localeCompare(b.branch ?? '') || a.id.localeCompare(b.id))
      const rows = Math.ceil(list.length / DESKS_PER_ROW)
      const wingH = WING_HEADER + WING_PAD + rows * DESK_H + (rows - 1) * GAP + WING_PAD

      if (x + wingW > this.scale.width && x > GAP) {
        x = GAP
        y += rowH + GAP
        rowH = 0
      }

      const floor = this.add.rectangle(x, y, wingW, wingH, 0x262a35).setOrigin(0).setStrokeStyle(2, 0x3a3f4d)
      const title = this.add.text(x + WING_PAD, y + 8, `Ala ${list[0]!.project}`, {
        fontFamily: FONT,
        fontSize: '16px',
        fontStyle: 'bold',
        color: '#e8e6e3'
      })
      const count = this.add
        .text(x + wingW - WING_PAD, y + 10, `${list.length} funcionário(s)`, { fontFamily: FONT, fontSize: '12px', color: '#7d8590' })
        .setOrigin(1, 0)
      floor.setDepth(0)
      this.wings.push(floor, title, count)

      list.forEach((s, i) => {
        const dx = x + WING_PAD + (i % DESKS_PER_ROW) * (DESK_W + GAP)
        const dy = y + WING_HEADER + WING_PAD + Math.floor(i / DESKS_PER_ROW) * (DESK_H + GAP)
        let desk = this.desks.get(s.id)
        if (!desk) {
          desk = new Desk(this, dx, dy)
          this.desks.set(s.id, desk)
        }
        desk.moveTo(dx, dy)
        desk.update(s)
      })

      x += wingW + GAP
      rowH = Math.max(rowH, wingH)
    }
  }
}
