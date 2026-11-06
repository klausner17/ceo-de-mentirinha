// O escritório é uma casa: o hall (mapa do Tiled) em cima e, descendo dele, um corredor
// central com um cômodo (ala) por projeto de cada lado, cada um com sua porta para o
// corredor. Role com a roda do mouse ou arraste para andar pela casa.

import Phaser from 'phaser'
import type { SessionState } from '@shared/types'
import { createAnimations, mapa, personKey, preload, SCALE, SCREEN, TILE, TILES } from '../art'
import { buildNav, type HallMap, type Rect } from '../nav'
import { planHouse, type HouseFrame, type Room, WALL_TILES } from '../house'
import { roomKey, roomPeople } from '../describe'
import { Desk, DESK_H, DESK_W, FONT } from './Desk'
import { OfficeBoys } from './OfficeBoys'

const GAP = 16
const WING_PAD = 16
const WALL = TILE * WALL_TILES
const DESKS_PER_ROW = 2
const DESK_SIZE = { w: DESK_W, h: DESK_H, gap: GAP, pad: WING_PAD, perRow: DESKS_PER_ROW }

/** O que foi clicado: uma mesa (sessão), a placa de um cômodo (projeto) ou o computador do CEO. */
export type Selection = { kind: 'session'; id: string } | { kind: 'room'; key: string } | { kind: 'inbox' }

/** A mesa, a cadeira e o funcionário sentado bloqueiam a passagem; a plaquinha com o nome não. */
function deskObstacle(at: { x: number; y: number }): Rect {
  return { x: at.x + DESK_W / 2 - 52, y: at.y + 46, w: 104, h: 74 }
}

export class OfficeScene extends Phaser.Scene {
  private readonly sessions = new Map<string, SessionState>()
  private readonly desks = new Map<string, Desk>()
  private wings: Phaser.GameObjects.GameObject[] = []
  private empty?: Phaser.GameObjects.Text
  private frame: HouseFrame = { tile: TILE, width: 0, hallHeight: 0, corridor: { x: 0, w: 0 }, frontDoor: { x: 0, y: 0 } }
  private boys?: OfficeBoys
  /** Móveis do hall que não estão no tileset (portaria, mesa do CEO). */
  private hallObstacles: Rect[] = []
  /** Computador do CEO e o contador de emails não lidos em cima dele. */
  private ceoMonitor?: Phaser.GameObjects.Sprite
  private badge?: Phaser.GameObjects.Container
  private badgeText?: Phaser.GameObjects.Text
  /** Último pedido de setInbox, aplicado quando a cena fica pronta. */
  private inboxState = { unread: 0, total: 0 }
  private ready = false
  private selection: Selection | null = null
  /** Avisado quando a pessoa clica numa mesa ou na placa de um cômodo. */
  onSelect: (sel: Selection) => void = () => {}

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
    // "Esperando você há 3 min" envelhece sem chegar linha nova: atualiza as plaquinhas.
    this.time.addEvent({ delay: 30_000, loop: true, callback: () => this.refreshDesks() })
    this.layout()
  }

  private refreshDesks(): void {
    for (const [id, desk] of this.desks) {
      const s = this.sessions.get(id)
      if (s) desk.update(s)
    }
  }

  /** Marca a mesa aberta no painel (ou nenhuma). */
  select(sel: Selection | null): void {
    this.selection = sel
    for (const [id, desk] of this.desks) desk.setSelected(sel?.kind === 'session' && sel.id === id)
  }

  /** O hall vem do mapa do Tiled: parede, porta, estante, fichário, café e sala do CEO. */
  private buildHall(): void {
    const map = this.make.tilemap({ key: 'escritorio' })
    const tileset = map.addTilesetImage('tiles', 'tiles')
    if (!tileset) throw new Error('Tileset "tiles" não encontrado no mapa')
    for (const name of ['chao', 'moveis']) map.createLayer(name, tileset, 0, 0)?.setScale(SCALE).setDepth(0)
    const points = map.getObjectLayer('pontos')?.objects ?? []
    const at = (name: string) => {
      const p = points.find((o) => o.name === name)
      return { x: (p?.x ?? 0) * SCALE, y: (p?.y ?? 0) * SCALE }
    }
    const corridor = points.find((o) => o.name === 'corredor')
    if (!corridor) throw new Error('Objeto "corredor" não encontrado no mapa')
    this.frame = {
      tile: TILE,
      width: map.widthInPixels * SCALE,
      hallHeight: map.heightInPixels * SCALE,
      corridor: { x: (corridor.x ?? 0) * SCALE, w: (corridor.width ?? 0) * SCALE },
      frontDoor: { ...at('porta'), y: at('porta').y + TILE }
    }
    // Portaria com o malote: os office boys de MCP fazem fila na frente dela.
    const portaria = at('portaria')
    this.add.image(portaria.x, portaria.y, 'portaria').setScale(SCALE).setOrigin(0.5, 1).setDepth(1)
    this.add
      .text(portaria.x, portaria.y - 46, 'Portaria', { fontFamily: FONT, fontSize: '10px', color: '#1d1f27', backgroundColor: '#e8b923', padding: { x: 3, y: 1 } })
      .setOrigin(0.5, 1)
      .setDepth(1)
    this.boys = new OfficeBoys(this, { x: portaria.x - 20, y: portaria.y + 16 })
    this.hallObstacles.push({ x: portaria.x - 32, y: portaria.y - 40, w: 64, h: 40 })
    const plate = at('placa-sala-do-ceo')
    this.add.text(plate.x + 8, plate.y, 'Sala do CEO', { fontFamily: FONT, fontSize: '12px', fontStyle: 'bold', color: '#e8c35b' }).setDepth(1)
    // O CEO (você) na própria mesa.
    const ceo = at('sala-do-ceo')
    this.hallObstacles.push({ x: ceo.x - 48, y: ceo.y - 30, w: 96, h: 66 })
    this.add.sprite(ceo.x, ceo.y + 4, personKey('diretor'), 0).setScale(SCALE).setOrigin(0.5, 1).setDepth(1)
    this.add.image(ceo.x, ceo.y - 4, 'mesa').setScale(SCALE).setOrigin(0.5, 0).setDepth(1)
    this.buildCeoComputer(ceo.x - 34, ceo.y + 4)
    this.add
      .text(ceo.x, ceo.y + 38, 'você', { fontFamily: FONT, fontSize: '11px', color: '#1d1f27', backgroundColor: '#e8c35b', padding: { x: 4, y: 1 } })
      .setOrigin(0.5, 0)
      .setDepth(1)
  }

  /**
   * O computador do CEO: quando alguém precisa de uma resposta, a tela mostra um envelope
   * e aparece o contador de emails não lidos. Clicar abre a caixa de entrada.
   */
  private buildCeoComputer(x: number, y: number): void {
    const monitor = this.add.sprite(x, y, 'monitor', SCREEN.desligado).setScale(SCALE).setOrigin(0.5, 1).setDepth(2)
    this.ceoMonitor = monitor
    const top = y - 12 * SCALE
    const circle = this.add.circle(0, 0, 10, 0xd7263d).setStrokeStyle(2, 0xffffff)
    this.badgeText = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '12px', fontStyle: 'bold', color: '#ffffff' }).setOrigin(0.5)
    this.badge = this.add.container(x + 7 * SCALE, top - 4, [circle, this.badgeText]).setDepth(3).setVisible(false)
    this.tweens.add({ targets: this.badge, scale: { from: 1, to: 1.15 }, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
    const hit = this.add.zone(x, y - 6 * SCALE, 16 * SCALE + 12, 12 * SCALE + 12).setInteractive({ useHandCursor: true }).setDepth(3)
    hit.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.getDistance() < 6) this.onSelect({ kind: 'inbox' })
    })
    this.setInbox(this.inboxState.unread, this.inboxState.total)
  }

  /** Atualiza o computador do CEO: `unread` emails não lidos de `total` na caixa. */
  setInbox(unread: number, total: number): void {
    this.inboxState = { unread, total }
    if (!this.ceoMonitor || !this.badge || !this.badgeText) return
    this.ceoMonitor.setFrame(total > 0 ? SCREEN.email : SCREEN.desligado)
    this.badgeText.setText(unread > 99 ? '99+' : String(unread))
    this.badge.setVisible(unread > 0)
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

  /** Uma faixa de tiles do tileset, já na escala da tela. */
  private strip(x: number, y: number, w: number, h: number, frame: number, depth = 1): Phaser.GameObjects.TileSprite {
    const t = this.add.tileSprite(x, y, w, h, 'tiles-quadros', frame).setOrigin(0).setTileScale(SCALE).setDepth(depth)
    this.wings.push(t)
    return t
  }

  /** Um cômodo: chão, parede de cima com o nome, paredes laterais e a porta para o corredor. */
  private drawRoom(room: Room, list: SessionState[]): void {
    const { x, y, w, h, floorY, side } = room
    this.strip(x, floorY, w, h - WALL, room.key ? TILES.carpete : TILES.carpeteB)
    this.strip(x, y, w, TILE, TILES.paredeTopo)
    this.strip(x, y + TILE, w, TILE, TILES.parede)

    const outerX = side === 'esquerda' ? x : x + w - TILE
    const innerX = side === 'esquerda' ? x + w - TILE : x
    this.strip(outerX, floorY, TILE, h - WALL, TILES.paredeLado, 2)
    // Porta: dois tiles de batente (o de baixo espelhado) e o resto da parede abaixo dela.
    const jambTop = this.add.image(innerX, floorY, 'tiles-quadros', TILES.batente).setOrigin(0).setScale(SCALE).setDepth(2)
    const jambBottom = this.add.image(innerX, floorY + TILE, 'tiles-quadros', TILES.batente).setOrigin(0).setScale(SCALE).setFlipY(true).setDepth(2)
    this.wings.push(jambTop, jambBottom)
    if (h - WALL > 2 * TILE) this.strip(innerX, floorY + 2 * TILE, TILE, h - WALL - 2 * TILE, TILES.paredeLado, 2)
    // Capacho no corredor, em frente à porta.
    const matX = side === 'esquerda' ? x + w : x - TILE
    const mat = this.add.image(matX, floorY + TILE / 2, 'tiles-quadros', TILES.tapete).setOrigin(0).setScale(SCALE).setDepth(1)
    this.wings.push(mat)

    const title = this.add
      .text(x + TILE + 4, y + TILE + 6, room.key ? `Ala ${room.name}` : room.name, {
        fontFamily: FONT,
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#1d1f27',
        backgroundColor: room.key ? '#e8c35b' : '#9aa1b2',
        padding: { x: 6, y: 2 }
      })
      .setDepth(3)
    this.wings.push(title)
    if (room.key) {
      const key = room.key
      title.setInteractive({ useHandCursor: true }).on('pointerup', (p: Phaser.Input.Pointer) => {
        if (p.getDistance() < 6) this.onSelect({ kind: 'room', key })
      })
      const people = this.add
        .text(x + w - TILE - 4, y + TILE + 8, roomPeople(list), { fontFamily: FONT, fontSize: '12px', color: '#e8e6e3' })
        .setOrigin(1, 0)
        .setDepth(3)
      this.wings.push(people)
    } else {
      // Sala livre: só uma planta e um sofá esperando o próximo projeto.
      const cx = x + w / 2
      const plant = this.add.image(x + TILE * 1.5, floorY + 8, 'tiles-quadros', TILES.planta).setOrigin(0).setScale(SCALE).setDepth(2)
      const sofaL = this.add.image(cx - TILE, floorY + TILE * 1.5, 'tiles-quadros', TILES.sofaE).setOrigin(0).setScale(SCALE).setDepth(2)
      const sofaR = this.add.image(cx, floorY + TILE * 1.5, 'tiles-quadros', TILES.sofaD).setOrigin(0).setScale(SCALE).setDepth(2)
      this.wings.push(plant, sofaL, sofaR)
    }
  }

  /** Agrupa por projeto, ordena por branch e redistribui cômodos e mesas pela casa. */
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
      const key = roomKey(s)
      const list = byProject.get(key) ?? []
      list.push(s)
      byProject.set(key, list)
    }
    const projects = [...byProject.entries()].sort(([a], [b]) => a.localeCompare(b))
    for (const [, list] of projects) list.sort((a, b) => (a.branch ?? '').localeCompare(b.branch ?? '') || a.id.localeCompare(b.id))

    const plan = planHouse(
      this.frame,
      projects.map(([key, list]) => ({ key, name: list[0]!.project, desks: list.length })),
      DESK_SIZE
    )
    const { width } = this.frame

    // Grade de caminhada: paredes do hall e dos cômodos, portas, corredor e móveis.
    const nav = buildNav({
      map: mapa as HallMap,
      tiles: TILES,
      tile: TILE,
      width,
      hallHeight: this.frame.hallHeight,
      plan,
      obstacles: [...this.hallObstacles, ...plan.rooms.flatMap((r) => r.desks.map(deskObstacle))]
    })
    this.boys?.setNav(nav)

    // Corredor central, parede de baixo e o contorno da casa.
    if (plan.corridor.h > 0) this.strip(plan.corridor.x, plan.corridor.y, plan.corridor.w, plan.corridor.h, TILES.piso, 0)
    this.strip(0, plan.bottom, width, TILE, TILES.paredeTopo)
    this.wings.push(this.add.rectangle(0, 0, width, plan.height).setOrigin(0).setStrokeStyle(4, 0x14151b).setDepth(4))

    for (const room of plan.rooms) {
      const list = room.key ? byProject.get(room.key)! : []
      this.drawRoom(room, list)
      list.forEach((s, i) => {
        const at = room.desks[i]!
        let desk = this.desks.get(s.id)
        if (!desk) {
          const id = s.id
          desk = new Desk(this, at.x, at.y, room.route, () => this.onSelect({ kind: 'session', id }))
          desk.setSelected(this.selection?.kind === 'session' && this.selection.id === id)
          this.desks.set(s.id, desk)
        }
        desk.setRoute(room.route)
        desk.setNav(nav)
        desk.moveTo(at.x, at.y)
        desk.update(s)
      })
    }

    this.empty?.destroy()
    this.empty = undefined
    if (projects.length === 0) {
      this.empty = this.add
        .text(width / 2, plan.height + 80, 'Casa vazia.\nAbra uma sessão do Claude Code para contratar alguém.', {
          fontFamily: FONT,
          fontSize: '18px',
          color: '#9aa1b2',
          align: 'center'
        })
        .setOrigin(0.5)
    }
    const bottom = projects.length === 0 ? plan.height + 160 : plan.height + GAP
    this.cameras.main.setBounds(0, 0, Math.max(width, this.scale.width), Math.max(bottom, this.scale.height))
    this.boys?.sync([...this.sessions.values()], (id) => this.desks.get(id)?.anchor() ?? null)
  }
}
