// Office boys dos conectores MCP: cada chamada MCP vira um office boy que sai da mesa,
// entra na fila da portaria e volta com o envelope (deu certo) ou de mãos vazias,
// meio perdido (deu erro). Vários pedidos ao mesmo servidor formam fila.

import * as THREE from 'three'
import { mcpLabel } from '@shared/mcp'
import type { SessionState } from '@shared/types'
import { ITEM } from '../art'
import type { Point } from '../house'
import type { NavGrid } from '../nav'
import { Person } from './person'
import { type Clock, dispose, label, U, type Textures } from './kit'
import { pathTo, turnTowards, Walk } from './walker'

const SPEED = 170
const QUEUE_STEP = 24
const LANE_STEP = 40

interface Boy {
  id: string
  server: string
  startedAt: number
  person: Person
  carry: THREE.Sprite
  state: 'indo' | 'esperando' | 'voltando'
  /** Resultado que chegou enquanto ainda ia para a portaria. */
  outcome?: boolean | null
  home: Point
  target: Point | null
  walk: Walk | null
}

export class OfficeBoys {
  private readonly boys = new Map<string, Boy>()
  private readonly signs = new Map<string, { obj: THREE.Object3D; el: HTMLDivElement }>()
  private nav: NavGrid | null = null

  constructor(
    private readonly clock: Clock,
    private readonly tex: Textures,
    private readonly world: THREE.Object3D,
    /** Começo da fila, na frente do balcão da portaria. */
    private readonly portaria: Point
  ) {
    clock.add((dt) => {
      for (const boy of this.boys.values()) {
        boy.walk?.update(dt)
        if (boy.walk?.done) boy.walk = null
        if (!boy.walk && boy.state === 'esperando') {
          // Na fila, olhando para o balcão.
          turnTowards(boy.person.root, 0, -1, dt, 6)
        }
        boy.carry.position.y = 1.35 + Math.sin(performance.now() / 200) * 0.03
        boy.person.update(dt)
      }
      return false
    })
  }

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
    const person = new Person('officeboy', 0.8)
    person.root.position.set(home.x * U, 0, home.y * U)
    const carry = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.item(ITEM.envelope), transparent: true }))
    carry.scale.set(0.38, 0.38, 1)
    carry.visible = false
    person.root.add(carry)
    const tag = label(mcpLabel(server).slice(0, 12), 'officeboy')
    tag.obj.position.set(0, 1.6, 0)
    person.root.add(tag.obj)
    this.world.add(person.root)
    this.boys.set(id, { id, server, startedAt, person, carry, state: 'indo', home, target: null, walk: null })
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
        const spot = { x: this.portaria.x + i * QUEUE_STEP, y: this.portaria.y + lane * LANE_STEP }
        if (boy.target && boy.target.x === spot.x && boy.target.y === spot.y) return
        this.walkTo(boy, spot, () => {
          if (boy.state === 'indo') boy.state = 'esperando'
          if (boy.outcome !== undefined) this.goBack(boy, boy.outcome)
        })
      })
      this.sign(server, list.length, lane)
    })
    for (const [server, sign] of this.signs) {
      if (!byServer.has(server)) {
        dispose(sign.obj)
        this.signs.delete(server)
      }
    }
  }

  /** Placa acima da fila quando há mais de um esperando. */
  private sign(server: string, count: number, lane: number): void {
    let sign = this.signs.get(server)
    if (count < 2) {
      if (sign) dispose(sign.obj)
      this.signs.delete(server)
      return
    }
    if (!sign) {
      sign = label('', 'fila')
      this.world.add(sign.obj)
      this.signs.set(server, sign)
    }
    sign.el.textContent = `${mcpLabel(server)}: ${count} na fila`
    sign.obj.position.set((this.portaria.x + count * QUEUE_STEP) * U, 1.2, (this.portaria.y + lane * LANE_STEP) * U)
  }

  private goBack(boy: Boy, ok: boolean | null): void {
    boy.state = 'voltando'
    if (ok === false) {
      // Falhou: volta de mãos vazias, perdido, e some no meio do caminho.
      boy.carry.material.map = this.tex.item(ITEM.interrogacao)
      boy.carry.visible = true
      const here = { x: boy.person.root.position.x / U, y: boy.person.root.position.z / U }
      const guess = { x: (here.x + boy.home.x) / 2 + (Math.random() - 0.5) * 120, y: (here.y + boy.home.y) / 2 }
      const lost = this.nav?.nearestFree(guess) ?? guess
      this.walkTo(boy, lost, () => this.vanish(boy))
      return
    }
    if (ok) {
      boy.carry.material.map = this.tex.item(ITEM.envelope)
      boy.carry.visible = true
    }
    this.walkTo(boy, boy.home, () => this.vanish(boy))
  }

  private walkTo(boy: Boy, to: Point, done: () => void): void {
    boy.target = to
    boy.person.setPose('andando')
    const here = { x: boy.person.root.position.x / U, y: boy.person.root.position.z / U }
    boy.walk = new Walk(boy.person.root, pathTo(this.nav, here, to), SPEED, () => {
      boy.person.setPose('parado')
      done()
    })
  }

  private vanish(boy: Boy): void {
    this.boys.delete(boy.id)
    const root = boy.person.root
    this.clock.tween(0.3, (k) => root.scale.setScalar(Math.max(0.01, 0.8 * (1 - k))), () => dispose(root))
    this.arrangeQueues()
  }
}
