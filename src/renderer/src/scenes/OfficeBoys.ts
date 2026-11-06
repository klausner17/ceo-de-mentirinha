// Office boys dos conectores MCP: cada chamada MCP vira um office boy que sai da mesa,
// entra na fila da portaria e volta com o envelope (deu certo) ou de mãos vazias,
// meio perdido (deu erro). Vários pedidos ao mesmo servidor formam fila.

import Phaser from 'phaser'
import { mcpLabel } from '@shared/mcp'
import type { SessionState } from '@shared/types'
import { ITEM, SCALE } from '../art'
import type { NavGrid } from '../nav'
import { FONT } from './Desk'
import { pathTo, walkPath } from './walker'

const SPEED = 260
const QUEUE_STEP = 24
const LANE_STEP = 40

type Point = { x: number; y: number }

interface Boy {
  id: string
  server: string
  startedAt: number
  body: Phaser.GameObjects.Container
  sprite: Phaser.GameObjects.Sprite
  carry: Phaser.GameObjects.Sprite
  state: 'indo' | 'esperando' | 'voltando'
  /** Resultado que chegou enquanto ainda ia para a portaria. */
  outcome?: boolean | null
  home: Point
  target: Point | null
}

export class OfficeBoys {
  private readonly boys = new Map<string, Boy>()
  private readonly signs = new Map<string, Phaser.GameObjects.Text>()
  private nav: NavGrid | null = null

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly portaria: Point
  ) {}

  /** Grade de caminhada atual: os office boys desviam de paredes e móveis por ela. */
  setNav(nav: NavGrid): void {
    this.nav = nav
  }

  /** Reconcilia os office boys com as chamadas MCP de todas as sessões. */
  sync(sessions: SessionState[], anchor: (sessionId: string) => Point | null): void {
    const pending = new Set<string>()
    const results = new Map<string, boolean>()
    for (const s of sessions) {
      const home = anchor(s.id)
      for (const r of s.mcpResults) results.set(r.id, r.ok)
      for (const c of s.mcpCalls) {
        pending.add(c.id)
        if (!this.boys.has(c.id) && home) this.spawn(c.id, c.server, c.startedAt, home)
      }
    }

    for (const boy of this.boys.values()) {
      if (boy.state === 'voltando' || pending.has(boy.id)) continue
      const ok = results.has(boy.id) ? results.get(boy.id)! : null
      if (boy.state === 'indo') boy.outcome = ok
      else this.goBack(boy, ok)
    }
    this.arrangeQueues()
  }

  private spawn(id: string, server: string, startedAt: number, home: Point): void {
    const sprite = this.scene.add.sprite(0, 0, 'officeboy', 8).setScale(SCALE).setOrigin(0.5, 1)
    const carry = this.scene.add.sprite(0, -40, 'itens', ITEM.envelope).setScale(SCALE).setVisible(false)
    const label = this.scene.add
      .text(0, 1, mcpLabel(server).slice(0, 12), { fontFamily: FONT, fontSize: '9px', color: '#1d1f27', backgroundColor: '#e8b923', padding: { x: 2, y: 1 } })
      .setOrigin(0.5, 0)
    const body = this.scene.add.container(home.x, home.y, [sprite, carry, label]).setDepth(25)
    this.boys.set(id, { id, server, startedAt, body, sprite, carry, state: 'indo', home, target: null })
  }

  /** Fila por servidor: uma faixa por servidor, os mais antigos na frente do balcão. */
  private arrangeQueues(): void {
    const byServer = new Map<string, Boy[]>()
    for (const boy of this.boys.values()) {
      if (boy.state === 'voltando') continue
      const list = byServer.get(boy.server) ?? []
      list.push(boy)
      byServer.set(boy.server, list)
    }
    const servers = [...byServer.keys()].sort()
    servers.forEach((server, lane) => {
      const list = byServer.get(server)!.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
      list.forEach((boy, i) => {
        const spot = { x: this.portaria.x + i * QUEUE_STEP, y: this.portaria.y + 20 + lane * LANE_STEP }
        if (boy.target && boy.target.x === spot.x && boy.target.y === spot.y) return
        this.walk(boy, spot, () => {
          if (boy.state === 'indo') boy.state = 'esperando'
          if (boy.outcome !== undefined) this.goBack(boy, boy.outcome)
        })
      })
      this.sign(server, list.length, lane)
    })
    for (const [server, sign] of this.signs) {
      if (!byServer.has(server)) {
        sign.destroy()
        this.signs.delete(server)
      }
    }
  }

  /** Placa acima da fila quando há mais de um esperando. */
  private sign(server: string, count: number, lane: number): void {
    let sign = this.signs.get(server)
    if (count < 2) {
      sign?.destroy()
      this.signs.delete(server)
      return
    }
    if (!sign) {
      sign = this.scene.add.text(0, 0, '', { fontFamily: FONT, fontSize: '10px', color: '#e8e6e3', backgroundColor: '#1d1f27cc', padding: { x: 3, y: 1 } }).setDepth(26)
      this.signs.set(server, sign)
    }
    sign.setText(`${mcpLabel(server)}: ${count} na fila`).setPosition(this.portaria.x + count * QUEUE_STEP, this.portaria.y + 2 + lane * LANE_STEP)
  }

  private goBack(boy: Boy, ok: boolean | null): void {
    boy.state = 'voltando'
    if (ok === false) {
      // Falhou: volta de mãos vazias, perdido, e some no meio do caminho.
      boy.carry.setFrame(ITEM.interrogacao).setVisible(true)
      const guess = { x: (boy.body.x + boy.home.x) / 2 + Phaser.Math.Between(-60, 60), y: (boy.body.y + boy.home.y) / 2 }
      const lost = this.nav?.nearestFree(guess) ?? guess
      this.walk(boy, lost, () => this.vanish(boy))
      return
    }
    if (ok) boy.carry.setFrame(ITEM.envelope).setVisible(true)
    this.walk(boy, boy.home, () => this.vanish(boy))
  }

  private walk(boy: Boy, to: Point, done: () => void): void {
    boy.target = to
    boy.sprite.play('officeboy-andando', true)
    walkPath(pathTo(this.nav, { x: boy.body.x, y: boy.body.y }, to), {
      scene: this.scene,
      movers: [{ obj: boy.body }],
      speed: SPEED,
      onLeg: (left) => boy.sprite.setFlipX(left),
      done: () => {
        boy.sprite.stop().setFrame(8).setFlipX(false)
        done()
      }
    })
  }

  private vanish(boy: Boy): void {
    this.boys.delete(boy.id)
    this.scene.tweens.add({ targets: boy.body, alpha: 0, duration: 300, onComplete: () => boy.body.destroy() })
    this.arrangeQueues()
  }
}
