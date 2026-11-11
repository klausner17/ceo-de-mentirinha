// Uma mesa em 3D: funcionário sentado de costas para a câmera (olhando o monitor), pilha de
// papel, post-its, café, balão da ferramenta, plaquinha com o nome e os liderados em volta.

import * as THREE from 'three'
import type { Deliverables, SessionState, SubagentState } from '@shared/types'
import { seniorityFor } from '@shared/seniority'
import { ITEM, type Screen } from '../art'
import type { Point } from '../house'
import type { NavGrid } from '../nav'
import { CHIP_COLORS, deliverableChips, deskLine, newDeliveries, sessionTitle } from '../describe'
import { describeTool } from '../tools'
import { Person, type Look } from './person'
import { box, Clock, dispose, easeBack, easeOut, itemSprite, label, mat, U, type Textures } from './kit'
import { pathTo, turnTowards, Walk } from './walker'

/** Tamanho do lugar de uma mesa no plano da casa, em pixels (as contas de house.ts usam). */
export const DESK_W = 224
export const DESK_H = 176

const SHEET_TOKENS = 20_000
const MAX_SHEETS = 10
/** Contexto acima desta fração do limite: funcionário cansado (suor e café). */
const TIRED = 0.8
/** Um erro mais antigo que isto não dispara o papel amassado (ex.: ao abrir o app). */
const ERROR_FRESH_MS = 30_000
/** Velocidade dos liderados andando, em pixels do plano por segundo. */
const WALK_SPEED = 150

/** Onde fica cada coisa dentro do lugar da mesa, em pixels a partir do canto de cima. */
const CX = DESK_W / 2
const TABLE = { x: CX, y: 80, w: 96, d: 40, h: 0.62 }
const CHAIR = { x: CX, y: 116 }
/** Frente da mesa: onde fica a plaquinha e de onde dá para abrir a mesa andando. */
export const DESK_FRONT = { x: CX, y: 156 }

const p3 = (x: number, y: number, h = 0): [number, number, number] => [x * U, h, y * U]

interface Subordinate {
  person: Person
  tag: HTMLDivElement
  arrived: boolean
  slot: number
  walk: Walk | null
  working: boolean
}

export class Desk {
  readonly root = new THREE.Group()
  private readonly person = new Person('desconhecido')
  private readonly screen: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private readonly balloon: HTMLDivElement
  private readonly plate: HTMLDivElement
  private readonly plateTitle: HTMLDivElement
  private readonly plateLine: HTMLDivElement
  private readonly plateChips: HTMLDivElement
  private readonly zzz: THREE.Sprite
  private readonly sweat: THREE.Sprite
  private readonly coffee: THREE.Group
  private readonly papers = new THREE.Group()
  private readonly postits = new THREE.Group()
  private readonly ring: THREE.Mesh
  private readonly team = new Map<string, Subordinate>()
  private chipsKey = ''
  private delivered: Deliverables | null = null
  private screenState: Screen = 'desligado'
  private errorUntil = 0
  private lastErrorAt: number | null = null
  private sheetsFull = false
  private nav: NavGrid | null = null
  private selected = false
  private hover = false
  /** Canto de cima do lugar da mesa, no plano (para onde ela está indo). */
  private x: number
  private y: number
  private stopMove: (() => void) | null = null
  private time = 0

  constructor(
    private readonly clock: Clock,
    private readonly tex: Textures,
    /** Onde ficam as coisas soltas que saem da mesa (confete, papel amassado, liderados). */
    private readonly world: THREE.Object3D,
    x: number,
    y: number,
    /** Caminho da porta da rua até dentro do cômodo: hall, corredor e porta da ala. */
    private route: Point[],
    /** Clique na mesa ou na plaquinha: abre o painel de detalhes. */
    private readonly onClick: () => void
  ) {
    this.x = x
    this.y = y
    this.root.position.set(x * U, 0, y * U)
    this.root.userData.pick = onClick

    // Área clicável: o lugar inteiro da mesa (invisível).
    const hit = new THREE.Mesh(new THREE.BoxGeometry(DESK_W * U, 1.6, (DESK_H - 30) * U), new THREE.MeshBasicMaterial({ visible: false }))
    hit.position.set(...p3(CX, (DESK_H - 30) / 2, 0.8))
    this.root.add(hit)

    // Mesa: tampo de madeira, pés e um gaveteiro.
    const wood = mat('#b98556')
    const woodDark = mat('#7a5232')
    this.root.add(box(TABLE.w * U, 0.07, TABLE.d * U, wood, p3(TABLE.x, TABLE.y, TABLE.h)))
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
      this.root.add(box(0.07, TABLE.h, 0.07, woodDark, p3(TABLE.x + dx * (TABLE.w / 2 - 4), TABLE.y + dz * (TABLE.d / 2 - 4), TABLE.h / 2)))
    }
    this.root.add(box(0.5, 0.45, 0.9, woodDark, p3(TABLE.x + 30, TABLE.y, 0.3)))

    // Monitor virado para a cadeira (e para a câmera, por cima do ombro).
    const monitor = new THREE.Group()
    monitor.position.set(...p3(TABLE.x - 22, TABLE.y - 8, TABLE.h + 0.035))
    monitor.add(box(0.08, 0.16, 0.08, mat('#2c2f3a'), [0, 0.08, 0]))
    monitor.add(box(0.26, 0.03, 0.18, mat('#2c2f3a'), [0, 0.015, 0]))
    monitor.add(box(0.66, 0.5, 0.06, mat('#14151a'), [0, 0.42, 0]))
    this.screen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.45), new THREE.MeshBasicMaterial({ map: tex.screen('desligado') }))
    this.screen.position.set(0, 0.42, 0.031)
    monitor.add(this.screen)
    this.root.add(monitor)

    this.papers.position.set(...p3(TABLE.x + 28, TABLE.y + 4, TABLE.h + 0.04))
    this.root.add(this.papers)

    const postitColors = ['#ffe066', '#ff9cac', '#7ee787']
    postitColors.forEach((c, i) => {
      const note = box(0.14, 0.01, 0.14, mat(c), [(-1 + i) * 0.22, 0, 0])
      note.rotation.y = (i - 1) * 0.3
      this.postits.add(note)
    })
    this.postits.position.set(...p3(TABLE.x - 4, TABLE.y + 12, TABLE.h + 0.04))
    this.postits.visible = false
    this.root.add(this.postits)

    // Café: caneca com fumacinha (aparece quando o contexto está quase cheio).
    this.coffee = new THREE.Group()
    this.coffee.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.13, 12), mat('#f4f1ea')))
    const brew = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 12), mat('#6b4226'))
    brew.position.y = 0.06
    this.coffee.add(brew)
    this.coffee.position.set(...p3(TABLE.x + 8, TABLE.y + 12, TABLE.h + 0.1))
    this.coffee.visible = false
    this.root.add(this.coffee)

    // Cadeira com o encosto para o lado da câmera.
    const chair = new THREE.Group()
    chair.position.set(...p3(CHAIR.x, CHAIR.y))
    chair.add(box(0.5, 0.07, 0.48, mat('#3a3f4d'), [0, 0.38, 0]))
    chair.add(box(0.5, 0.5, 0.07, mat('#3a3f4d'), [0, 0.68, 0.24]))
    chair.add(box(0.06, 0.35, 0.06, mat('#2c2f3a'), [0, 0.18, 0]))
    chair.add(box(0.4, 0.04, 0.4, mat('#2c2f3a'), [0, 0.02, 0]))
    this.root.add(chair)

    this.person.root.position.set(...p3(CHAIR.x, CHAIR.y - 4))
    this.person.root.rotation.y = Math.PI
    this.root.add(this.person.root)

    // Marca no chão quando a mesa está aberta no painel.
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.02, 40), new THREE.MeshBasicMaterial({ color: '#e8c35b', transparent: true, opacity: 0.85 }))
    this.ring.rotation.x = -Math.PI / 2
    this.ring.position.set(...p3(CX, TABLE.y + 16, 0.02))
    this.ring.visible = false
    this.root.add(this.ring)

    this.zzz = itemSprite(tex, ITEM.z, 0.35)
    this.zzz.position.set(...p3(CHAIR.x + 14, CHAIR.y - 4, 1.45))
    this.zzz.visible = false
    this.sweat = itemSprite(tex, ITEM.suor, 0.25)
    this.sweat.position.set(...p3(CHAIR.x + 10, CHAIR.y - 4, 1.35))
    this.sweat.visible = false
    this.root.add(this.zzz, this.sweat)

    // Balão com a ferramenta em uso, acima da cabeça.
    const b = label('', 'balao')
    b.obj.position.set(...p3(CHAIR.x, CHAIR.y, 1.85))
    this.balloon = b.el
    this.balloon.hidden = true
    this.root.add(b.obj)

    // Plaquinha com o nome, o que está fazendo e as entregas, na frente da mesa.
    const plate = label('', 'placa', () => this.onClick())
    this.plate = plate.el
    this.plateChips = document.createElement('div')
    this.plateChips.className = 'chips'
    this.plateTitle = document.createElement('div')
    this.plateTitle.className = 'titulo'
    this.plateLine = document.createElement('div')
    this.plateLine.className = 'linha'
    this.plate.append(this.plateChips, this.plateTitle, this.plateLine)
    this.plate.addEventListener('pointerenter', () => this.setHover(true))
    this.plate.addEventListener('pointerleave', () => this.setHover(false))
    plate.obj.position.set(...p3(DESK_FRONT.x, DESK_FRONT.y, 0))
    this.root.add(plate.obj)

    // Chega crescendo.
    this.root.scale.setScalar(0.01)
    clock.tween(0.45, (k) => this.root.scale.setScalar(Math.max(0.01, k)), undefined, easeBack)
    clock.add((dt) => this.tick(dt))
  }

  private disposed = false

  /** Animações contínuas: pose, Z, suor, post-its e os liderados andando. */
  private tick(dt: number): boolean {
    if (this.disposed) return true
    this.time += dt
    this.person.update(dt)
    this.zzz.position.y = 1.45 + ((this.time * 0.35) % 0.35)
    this.zzz.material.opacity = 1 - ((this.time * 0.35) % 0.35) / 0.35
    this.sweat.position.y = 1.35 - ((this.time * 0.8) % 0.2)
    this.postits.position.y = TABLE.h + 0.04 + Math.abs(Math.sin(this.time * 6)) * 0.03
    if (this.errorUntil && Date.now() >= this.errorUntil) {
      this.errorUntil = 0
      this.paintScreen()
    }
    for (const sub of this.team.values()) {
      sub.walk?.update(dt)
      if (sub.walk?.done) sub.walk = null
      if (sub.arrived && !sub.walk) {
        // Parado ao lado do chefe, virado para a mesa.
        const tx = (this.x + TABLE.x) * U - sub.person.root.position.x
        const tz = (this.y + TABLE.y) * U - sub.person.root.position.z
        turnTowards(sub.person.root, tx, tz, dt, 6)
        sub.person.setPose(sub.working ? 'prancheta' : 'parado')
      }
      sub.person.update(dt)
    }
    return false
  }

  setRoute(route: Point[]): void {
    this.route = route
  }

  /** Grade de caminhada atual: os liderados desviam de paredes e móveis por ela. */
  setNav(nav: NavGrid): void {
    this.nav = nav
  }

  /** Ponto (no plano) ao lado da mesa, de onde saem e para onde voltam os office boys. */
  anchor(): Point {
    return { x: this.x + DESK_W - 20, y: this.y + 118 }
  }

  /** Ponto (no plano) na frente da mesa: chegando perto dele, o CEO pode abrir a mesa. */
  front(): Point {
    return { x: this.x + DESK_FRONT.x, y: this.y + DESK_FRONT.y }
  }

  moveTo(x: number, y: number): void {
    if (this.x === x && this.y === y) return
    this.x = x
    this.y = y
    const from = this.root.position.clone()
    const to = new THREE.Vector3(x * U, 0, y * U)
    this.stopMove?.()
    this.stopMove = this.clock.tween(0.3, (k) => this.root.position.lerpVectors(from, to, k), undefined, easeOut)
    // Os liderados acompanham a mesa.
    for (const sub of this.team.values()) if (sub.arrived) this.walkSub(sub, this.slot(sub.slot))
  }

  update(s: SessionState): void {
    const seniority = s.seniority
    this.person.setLook(seniority)
    const idle = s.status === 'ocioso'
    const look = s.currentTool ? describeTool(s.currentTool.name) : null

    this.person.setPose(idle ? 'dormindo' : (look?.pose ?? 'sentado'))
    this.screenState = idle ? 'desligado' : (look?.screen ?? 'codigo')
    if (!this.errorUntil) this.paintScreen()

    if (look) {
      this.balloon.textContent = look.label
      this.balloon.style.background = look.color
      this.balloon.hidden = false
    } else this.balloon.hidden = true
    this.postits.visible = look?.postits === true

    this.zzz.visible = idle
    const tired = s.contextTokens >= s.contextLimit * TIRED
    this.sweat.visible = tired && !idle
    this.coffee.visible = tired

    this.plateTitle.textContent = sessionTitle(s)
    this.plateLine.textContent = deskLine(s, Date.now())
    this.plate.title = sessionTitle(s)

    this.updateDeliverables(s.deliverables)
    this.updatePapers(s.contextTokens, s.contextLimit)
    this.maybeCrumple(s.lastErrorAt)
    this.updateTeam(s.subagents)
  }

  private paintScreen(): void {
    this.screen.material.map = this.tex.screen(this.errorUntil ? 'erro' : this.screenState)
  }

  /** Mesa aberta no painel de detalhes: plaquinha dourada e marca no chão. */
  setSelected(selected: boolean): void {
    this.selected = selected
    this.paintPlate()
  }

  setHover(hover: boolean): void {
    this.hover = hover
    this.paintPlate()
  }

  private paintPlate(): void {
    this.plate.classList.toggle('selecionada', this.selected)
    this.plate.classList.toggle('hover', this.hover)
    this.ring.visible = this.selected
  }

  /** Plaquinhas de entrega e, quando chega algo novo, a comemoração. */
  private updateDeliverables(d: Deliverables): void {
    const chips = deliverableChips(d)
    const key = chips.map((c) => c.text).join('|')
    if (key !== this.chipsKey) {
      this.chipsKey = key
      this.plateChips.replaceChildren(
        ...chips.map((c) => {
          const e = document.createElement('span')
          e.textContent = c.text
          e.style.background = c.color
          return e
        })
      )
    }
    const fresh = newDeliveries(this.delivered, d)
    this.delivered = d
    const last = fresh.prs[fresh.prs.length - 1]
    if (last) this.celebrate(fresh.prs.length === 1 ? `PR #${last.number} aberto!` : `${fresh.prs.length} PRs abertos!`, CHIP_COLORS.pr, true)
    else if (fresh.artifacts > 0) this.celebrate(fresh.artifacts === 1 ? 'Novo artefato!' : `${fresh.artifacts} artefatos novos!`, CHIP_COLORS.artefato, false)
    else if (fresh.commits > 0) this.celebrate('Commit!', CHIP_COLORS.commit, false)
  }

  /** Texto subindo da mesa; num PR novo, também confete. */
  private celebrate(text: string, color: string, confetti: boolean): void {
    const origin = new THREE.Vector3((this.x + CX) * U, 1.4, (this.y + TABLE.y) * U)
    const tag = label(text, confetti ? 'festa grande' : 'festa')
    tag.el.style.background = color
    tag.obj.position.copy(origin)
    this.world.add(tag.obj)
    this.clock.tween(2.6, (k) => {
      tag.obj.position.y = origin.y + k * 1.4
      tag.el.style.opacity = String(k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25)
    }, () => dispose(tag.obj), easeOut)
    if (!confetti) return

    const colors = ['#3fb950', '#e8c35b', '#79c0ff', '#d2a8ff', '#ff7b72']
    const geo = new THREE.PlaneGeometry(0.07, 0.11)
    for (let i = 0; i < 40; i++) {
      const bit = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide }))
      bit.position.copy(origin)
      const a = Math.random() * Math.PI * 2
      const v = new THREE.Vector3(Math.cos(a) * (0.8 + Math.random() * 1.6), 3 + Math.random() * 2.5, Math.sin(a) * (0.8 + Math.random() * 1.6))
      const spin = new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10)
      this.world.add(bit)
      let life = 0
      this.clock.add((dt) => {
        life += dt
        v.y -= 7 * dt
        v.multiplyScalar(1 - dt * 1.2)
        bit.position.addScaledVector(v, dt)
        if (bit.position.y < 0.02) {
          bit.position.y = 0.02
          v.set(0, 0, 0)
          spin.set(0, 0, 0)
          bit.rotation.set(-Math.PI / 2, 0, bit.rotation.z)
        }
        bit.rotation.x += spin.x * dt
        bit.rotation.y += spin.y * dt
        bit.rotation.z += spin.z * dt
        if (life > 4) bit.scale.setScalar(Math.max(0.01, 1 - (life - 4)))
        if (life > 5) {
          bit.removeFromParent()
          bit.material.dispose()
          return true
        }
        return false
      })
    }
  }

  /** Pilha de papel: uma folha a cada 20 mil tokens; folhas novas caem na pilha. */
  private updatePapers(tokens: number, limit: number): void {
    const target = Math.min(MAX_SHEETS, Math.ceil(tokens / SHEET_TOKENS))
    const full = tokens >= limit * TIRED
    const paper = mat(full ? '#ffc9c9' : '#f4f1ea')
    while (this.papers.children.length < target) {
      const i = this.papers.children.length
      const sheet = box(0.34, 0.018, 0.44, paper)
      const rest = i * 0.024
      sheet.rotation.y = (Math.random() - 0.5) * 0.25
      this.papers.add(sheet)
      this.clock.tween(0.35, (k) => (sheet.position.y = rest + (1 - k) * 0.8), undefined, easeOut)
    }
    while (this.papers.children.length > target) this.papers.children[this.papers.children.length - 1]!.removeFromParent()
    if (full !== this.sheetsFull) {
      this.sheetsFull = full
      for (const sheet of this.papers.children) (sheet as THREE.Mesh).material = paper
    }
  }

  /** Erro numa ferramenta: monitor vermelho, papel amassado voando e fumaça. */
  private maybeCrumple(lastErrorAt: number | null): void {
    if (lastErrorAt === null || lastErrorAt === this.lastErrorAt) return
    const first = this.lastErrorAt === null
    this.lastErrorAt = lastErrorAt
    if (first && Date.now() - lastErrorAt > ERROR_FRESH_MS) return

    this.errorUntil = Date.now() + 2500
    this.paintScreen()

    const from = new THREE.Vector3((this.x + CX) * U, 1.1, (this.y + CHAIR.y) * U)
    const land = new THREE.Vector3((this.x + DESK_W - 30 - Math.random() * 30) * U, 0.09, (this.y + CHAIR.y + 14) * U)
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), mat('#f4f1ea'))
    ball.castShadow = true
    ball.position.copy(from)
    this.world.add(ball)
    this.clock.tween(0.7, (k) => {
      ball.position.lerpVectors(from, land, k)
      ball.position.y = THREE.MathUtils.lerp(from.y, land.y, k) + Math.sin(k * Math.PI) * 0.6
      ball.rotation.x = k * 6
    }, () => this.clock.tween(1, (k) => ball.scale.setScalar(Math.max(0.01, 1 - k)), () => {
      ball.removeFromParent()
      ball.geometry.dispose()
    }, undefined, 20))

    for (let i = 0; i < 3; i++) {
      const puff = itemSprite(this.tex, ITEM.fumaca, 0.3)
      const start = new THREE.Vector3((this.x + TABLE.x - 22) * U, 1.2, (this.y + TABLE.y - 8) * U)
      puff.position.copy(start)
      puff.material.opacity = 0
      this.world.add(puff)
      this.clock.tween(1.5, (k) => {
        puff.position.set(start.x + (i - 1) * 0.15 * k, start.y + k * 1.2, start.z)
        puff.scale.setScalar(0.3 + k * 0.5)
        puff.material.opacity = 0.9 * (1 - k)
      }, () => dispose(puff), easeOut, i * 0.25)
    }
  }

  /** Posição (no plano) de cada liderado em volta da mesa, do lado esquerdo. */
  private slot(i: number): Point {
    const col = i % 2
    const row = Math.floor(i / 2)
    return { x: this.x + 18 + col * 26, y: this.y + 64 + row * 30 }
  }

  /** Liderados entram pela porta da rua, atravessam a casa até o chefe e saem ao terminar. */
  private updateTeam(subagents: SubagentState[]): void {
    const alive = new Set(subagents.map((a) => a.id))
    for (const [id, sub] of this.team) {
      if (!alive.has(id)) {
        this.team.delete(id)
        this.leaveThroughDoor(sub)
      }
    }
    const used = new Set([...this.team.values()].map((s) => s.slot))
    for (const a of subagents) {
      let sub = this.team.get(a.id)
      if (!sub) {
        let slot = 0
        while (used.has(slot)) slot++
        used.add(slot)
        const person = new Person(seniorityFor(a.model) as Look, 0.75)
        const start = this.route[0] ?? { x: 0, y: 0 }
        person.root.position.set(start.x * U, 0, start.y * U)
        const tag = label((a.agentType ?? 'agente').split(/[-_ ]/)[0]!.slice(0, 9), 'liderado')
        tag.obj.position.set(0, 1.55, 0)
        person.root.add(tag.obj)
        this.world.add(person.root)
        const s: Subordinate = { person, tag: tag.el, arrived: false, slot, walk: null, working: false }
        sub = s
        this.team.set(a.id, s)
        this.walkSub(s, this.slot(slot), () => (s.arrived = true), this.route.slice(1))
      }
      sub.working = a.currentTool !== null
    }
  }

  /**
   * Anda até `to` pela grade de caminhada, desviando de paredes e móveis. Sem grade,
   * passa pelos pontos de reserva (a rota pelas portas) e segue em linha reta.
   */
  private walkSub(sub: Subordinate, to: Point, done?: () => void, fallback: Point[] = []): void {
    const from = { x: sub.person.root.position.x / U, y: sub.person.root.position.z / U }
    sub.person.setPose('andando')
    sub.walk = new Walk(sub.person.root, pathTo(this.nav, from, to, fallback), WALK_SPEED, () => {
      sub.person.setPose('parado')
      done?.()
    })
  }

  private leaveThroughDoor(sub: Subordinate): void {
    sub.arrived = false
    const exit = this.route[0] ?? { x: sub.person.root.position.x / U, y: sub.person.root.position.z / U }
    // Continua andando e se atualizando pelo relógio até sair pela porta da rua.
    this.walkSub(sub, exit, () => {
      this.clock.tween(0.3, (k) => sub.person.root.scale.setScalar(Math.max(0.01, 0.75 * (1 - k))), () => dispose(sub.person.root))
    }, [...this.route].reverse().slice(1, -1))
    this.clock.add((dt) => {
      sub.walk?.update(dt)
      sub.person.update(dt)
      return !sub.person.root.parent
    })
  }

  leave(): void {
    for (const sub of this.team.values()) this.leaveThroughDoor(sub)
    this.team.clear()
    this.clock.tween(0.4, (k) => this.root.scale.setScalar(Math.max(0.01, 1 - k)), () => {
      this.disposed = true
      dispose(this.root)
    })
  }
}
