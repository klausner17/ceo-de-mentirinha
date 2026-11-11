// O escritório em 3D. É uma casa: o hall (do mapa do Tiled) em cima e, descendo dele, um
// corredor central com um cômodo (ala) por projeto de cada lado, cada um com sua porta.
// Você é o CEO: anda pela casa com WASD ou setas, chega perto de uma mesa e aperta E para
// abrir os detalhes (ou clica nela). Arrastar gira a câmera e a roda do mouse aproxima.

import * as THREE from 'three'
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import type { SessionState } from '@shared/types'
import { loadArt, mapa, TILE, TILES } from '../art'
import { buildNav, type HallMap, type NavGrid, type Rect } from '../nav'
import { planHouse, type HouseFrame, type HousePlan, type Room, type Point } from '../house'
import { roomKey, roomPeople, sessionTitle } from '../describe'
import { canStand, direction, nearest, walk } from '../move'
import { Desk, DESK_H, DESK_W } from './desk'
import { OfficeBoys } from './office-boys'
import { Person } from './person'
import { at3, box, Clock, dispose, label, mat, Textures, U, WALL_H } from './kit'
import { turnTowards } from './walker'

const GAP = 16
const WING_PAD = 16
const DESKS_PER_ROW = 2
const DESK_SIZE = { w: DESK_W, h: DESK_H, gap: GAP, pad: WING_PAD, perRow: DESKS_PER_ROW }

/** O que foi clicado: uma mesa (sessão), a placa de um cômodo (projeto), o computador do CEO ou o quadro de entregas. */
export type Selection = { kind: 'session'; id: string } | { kind: 'room'; key: string } | { kind: 'inbox' } | { kind: 'entregas' }

/** Onde fica o quadro de entregas no hall (centro, em pixels do plano), entre o fichário e a planta. */
const BOARD_AT = { x: 404, y: 84 }
const BOARD_W = 84

/** Velocidade do CEO, em pixels do plano por segundo (com Shift, corre). */
const CEO_SPEED = 200
const CEO_RADIUS = 9
/** Distância (no plano) até onde o CEO alcança uma mesa, o computador ou o quadro. */
const REACH = 64

const GID_MASK = 0x1fffffff
const wallColor = '#6c7489'
const wallTop = '#545a6d'

/** A mesa, a cadeira e o funcionário sentado bloqueiam a passagem; a plaquinha com o nome não. */
function deskObstacle(at: Point): Rect {
  return { x: at.x + DESK_W / 2 - 52, y: at.y + 54, w: 104, h: 80 }
}

interface Reachable {
  at: Point
  hint: string
  sel: Selection
}

export class Office3D {
  private readonly sessions = new Map<string, SessionState>()
  private readonly desks = new Map<string, Desk>()
  private readonly clock = new Clock()
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400)
  private readonly renderer: THREE.WebGLRenderer
  private readonly labels = new CSS2DRenderer()
  private readonly sun = new THREE.DirectionalLight('#fff4e0', 2.2)
  private readonly world = new THREE.Group()
  private house = new THREE.Group()
  private houseKey = ''
  private readonly roomLabels = new Map<string, HTMLSpanElement>()
  private emptyLabel: THREE.Object3D | null = null
  private tex!: Textures
  private frame: HouseFrame = { tile: TILE, width: 0, hallHeight: 0, corridor: { x: 0, w: 0 }, frontDoor: { x: 0, y: 0 } }
  private plan: HousePlan | null = null
  private nav: NavGrid | null = null
  private boys?: OfficeBoys
  /** Móveis do hall que não estão no tileset (portaria, mesa do CEO, quadro). */
  private hallObstacles: Rect[] = []
  private ceoDesk: Point = { x: 0, y: 0 }
  /** Computador do CEO e o contador de emails não lidos em cima dele. */
  private ceoScreen?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private badge?: HTMLDivElement
  private inboxState = { unread: 0, total: 0 }
  /** Quadro de entregas do hall, desenhado num canvas. */
  private board?: { root: THREE.Group; canvas: HTMLCanvasElement; texture: THREE.CanvasTexture }
  private boardState = { lines: ['Nada entregue ainda'], prs: 0, empty: true }
  private boardSeen = false
  private ready = false
  private selection: Selection | null = null

  /** Você. */
  private readonly ceo = new Person('ceo')
  private ceoAt: Point = { x: 0, y: 0 }
  private readonly keys = { up: false, down: false, left: false, right: false, run: false }
  private reach: Reachable | null = null

  /** Câmera em volta do CEO: giro, inclinação e distância. */
  private yaw = 0
  private pitch = 0.8
  private distance = 15
  private readonly focus = new THREE.Vector3()

  private readonly raycaster = new THREE.Raycaster()
  private readonly pickables: THREE.Object3D[] = []
  private hovered: THREE.Object3D | null = null

  /** Avisado quando a pessoa clica (ou aperta E) numa mesa, numa placa, no computador ou no quadro. */
  onSelect: (sel: Selection) => void = () => {}

  constructor(
    private readonly container: HTMLElement,
    /** Dica de interação ("E · abrir mesa de..."), embaixo da tela. */
    private readonly hintEl: HTMLElement
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.domElement.className = 'mundo'
    this.labels.domElement.className = 'rotulos'
    container.prepend(this.renderer.domElement, this.labels.domElement)

    this.scene.background = new THREE.Color('#1d1f27')
    this.scene.add(new THREE.HemisphereLight('#f3f0ff', '#3a3326', 1.7))
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    const sc = this.sun.shadow.camera
    sc.left = sc.bottom = -20
    sc.right = sc.top = 20
    sc.near = 1
    sc.far = 60
    this.sun.shadow.bias = -0.0005
    this.scene.add(this.sun, this.sun.target, this.world)
    this.world.add(this.house)

    new ResizeObserver(() => this.resize()).observe(container)
    this.resize()
    this.setupInput()
  }

  /** Carrega a arte, monta o hall e começa a desenhar. */
  async start(): Promise<void> {
    this.tex = new Textures(await loadArt())
    this.buildHall()
    this.boys = new OfficeBoys(this.clock, this.tex, this.world, { x: this.portaria.x - 20, y: this.portaria.y + 24 })
    // O CEO começa na frente da própria mesa.
    this.ceoAt = { x: this.ceoDesk.x, y: this.ceoDesk.y + 64 }
    this.ceo.root.position.copy(at3(this.ceoAt))
    const you = label('você', 'voce')
    you.obj.position.set(0, 1.75, 0)
    this.ceo.root.add(you.obj)
    this.world.add(this.ceo.root)
    this.focus.copy(this.ceo.root.position)

    this.ready = true
    this.layout()
    // "Esperando você há 3 min" envelhece sem chegar linha nova: atualiza as plaquinhas.
    setInterval(() => this.refreshDesks(), 30_000)
    let last = performance.now()
    const loop = (now: number): void => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      this.frameTick(dt, now / 1000)
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth)
    const h = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(w, h)
    this.labels.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  // ------------------------------------------------------------------ entrada

  private setupInput(): void {
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    }
    const set = (e: KeyboardEvent, down: boolean): boolean => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          this.keys.up = down
          return true
        case 'KeyS':
        case 'ArrowDown':
          this.keys.down = down
          return true
        case 'KeyA':
        case 'ArrowLeft':
          this.keys.left = down
          return true
        case 'KeyD':
        case 'ArrowRight':
          this.keys.right = down
          return true
        case 'ShiftLeft':
        case 'ShiftRight':
          this.keys.run = down
          return false
      }
      return false
    }
    window.addEventListener('keydown', (e) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return
      if (set(e, true)) e.preventDefault()
      if ((e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space') && this.reach && !e.repeat) {
        e.preventDefault()
        this.onSelect(this.reach.sel)
      }
    })
    window.addEventListener('keyup', (e) => set(e, false))
    window.addEventListener('blur', () => Object.assign(this.keys, { up: false, down: false, left: false, right: false, run: false }))

    // Arrastar gira a câmera; clicar (sem arrastar) abre o que estiver embaixo do mouse.
    const canvas = this.renderer.domElement
    let down: { x: number; y: number; moved: number } | null = null
    canvas.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, moved: 0 }
      canvas.setPointerCapture(e.pointerId)
    })
    canvas.addEventListener('pointermove', (e) => {
      if (down) {
        const dx = e.clientX - down.x
        const dy = e.clientY - down.y
        down.moved += Math.abs(dx) + Math.abs(dy)
        down.x = e.clientX
        down.y = e.clientY
        if (down.moved > 6) {
          this.yaw -= dx * 0.006
          this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, 0.35, 1.45)
        }
        return
      }
      this.hover(this.pick(e))
    })
    canvas.addEventListener('pointerup', (e) => {
      const wasClick = down !== null && down.moved <= 6
      down = null
      if (!wasClick) return
      const hit = this.pick(e)
      const action = hit?.userData.pick as (() => void) | undefined
      action?.()
    })
    canvas.addEventListener('pointerleave', () => this.hover(null))
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(e.deltaY * 0.0012), 4, 60)
      },
      { passive: false }
    )
  }

  /** O objeto clicável embaixo do mouse (o primeiro ancestral com `userData.pick`). */
  private pick(e: PointerEvent): THREE.Object3D | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.camera)
    for (const hit of this.raycaster.intersectObjects(this.pickables, true)) {
      let o: THREE.Object3D | null = hit.object
      while (o && !o.userData.pick) o = o.parent
      if (o) return o
    }
    return null
  }

  private hover(o: THREE.Object3D | null): void {
    if (o === this.hovered) return
    ;(this.hovered?.userData.hover as ((on: boolean) => void) | undefined)?.(false)
    this.hovered = o
    ;(o?.userData.hover as ((on: boolean) => void) | undefined)?.(true)
    this.renderer.domElement.style.cursor = o ? 'pointer' : ''
  }

  // ------------------------------------------------------------------ quadro a quadro

  private frameTick(dt: number, time: number): void {
    this.moveCeo(dt)
    this.clock.run(dt, time)
    this.ceo.update(dt)

    // A câmera segue o CEO devagar.
    const target = this.ceo.root.position
    this.focus.lerp(target, 1 - Math.exp(-dt * 6))
    const horiz = this.distance * Math.cos(this.pitch)
    this.camera.position.set(this.focus.x + Math.sin(this.yaw) * horiz, this.focus.y + this.distance * Math.sin(this.pitch), this.focus.z + Math.cos(this.yaw) * horiz)
    this.camera.lookAt(this.focus.x, this.focus.y + 0.6, this.focus.z)
    // A sombra acompanha (o mapa de sombra cobre só os arredores).
    this.sun.position.set(this.focus.x - 8, this.focus.y + 18, this.focus.z + 10)
    this.sun.target.position.copy(this.focus)

    // Os rótulos encolhem quando a câmera se afasta, para não cobrir a casa toda.
    const z = THREE.MathUtils.clamp(15 / this.distance, 0.4, 1.25).toFixed(2)
    if (this.labels.domElement.style.getPropertyValue('--z') !== z) this.labels.domElement.style.setProperty('--z', z)

    this.renderer.render(this.scene, this.camera)
    this.labels.render(this.scene, this.camera)
  }

  private moveCeo(dt: number): void {
    if (!this.nav) return
    const dir = direction(this.keys, this.yaw)
    const moving = dir.x !== 0 || dir.y !== 0
    if (moving) {
      const speed = CEO_SPEED * (this.keys.run ? 1.8 : 1) * dt
      this.ceoAt = walk(this.nav, this.ceoAt, dir.x * speed, dir.y * speed, CEO_RADIUS)
      this.ceo.root.position.set(this.ceoAt.x * U, 0, this.ceoAt.y * U)
      turnTowards(this.ceo.root, dir.x, dir.y, dt)
    }
    this.ceo.setPose(moving ? 'andando' : 'parado')
    this.updateReach()
  }

  /** O que está ao alcance do CEO (mesa, computador, quadro) e a dica na tela. */
  private updateReach(): void {
    const targets: Reachable[] = [
      { at: { x: this.ceoDesk.x, y: this.ceoDesk.y + 50 }, hint: 'abrir a caixa de entrada', sel: { kind: 'inbox' } },
      { at: { x: BOARD_AT.x, y: BOARD_AT.y + 44 }, hint: 'ver o quadro de entregas', sel: { kind: 'entregas' } }
    ]
    for (const [id, desk] of this.desks) {
      const s = this.sessions.get(id)
      if (s) targets.push({ at: desk.front(), hint: `abrir a mesa de ${sessionTitle(s)}`, sel: { kind: 'session', id } })
    }
    const reach = nearest(targets, this.ceoAt, REACH)
    const text = reach ? reach.hint : ''
    if (this.hintEl.dataset.text !== text) {
      this.hintEl.dataset.text = text
      this.hintEl.replaceChildren()
      if (reach) {
        const k = document.createElement('kbd')
        k.textContent = 'E'
        this.hintEl.append(k, ` ${reach.hint}`)
      }
      this.hintEl.hidden = !reach
    }
    this.reach = reach
  }

  // ------------------------------------------------------------------ hall

  private portaria: Point = { x: 0, y: 0 }

  /** O hall vem do mapa do Tiled: parede com janelas, porta, estante, fichário, café e Sala do CEO. */
  private buildHall(): void {
    type Obj = { name: string; x: number; y: number; width?: number }
    const map = mapa as unknown as { width: number; height: number; tilewidth: number; layers: Array<{ name: string; type: string; data?: number[]; objects?: Obj[] }> }
    const scale = TILE / map.tilewidth
    const points: Obj[] = map.layers.find((l) => l.name === 'pontos')?.objects ?? []
    const at = (name: string): Point => {
      const p = points.find((o) => o.name === name)
      return { x: (p?.x ?? 0) * scale, y: (p?.y ?? 0) * scale }
    }
    const corridor = points.find((o) => o.name === 'corredor')
    if (!corridor) throw new Error('Objeto "corredor" não encontrado no mapa')
    this.frame = {
      tile: TILE,
      width: map.width * TILE,
      hallHeight: map.height * TILE,
      corridor: { x: corridor.x * scale, w: (corridor.width ?? 0) * scale },
      frontDoor: { ...at('porta'), y: at('porta').y + TILE }
    }
    const hall = new THREE.Group()
    this.world.add(hall)

    const chao = map.layers.find((l) => l.name === 'chao')?.data ?? []
    const moveis = map.layers.find((l) => l.name === 'moveis')?.data ?? []
    const tileAt = (layer: number[], tx: number, ty: number) => ((layer[ty * map.width + tx] ?? 0) & GID_MASK) - 1
    const wallTiles = new Set<number>([TILES.paredeTopo, TILES.parede, TILES.porta, TILES.janela, TILES.quadro])

    // Chão: todos os tiles do chão (e o tapete) num canvas só. A parede do fundo tem um tile
    // de espessura (a linha de cima do mapa); a linha da face dela vira chão, igual ao de baixo.
    const firstFloorRow = 1
    const canvas = document.createElement('canvas')
    canvas.width = map.width * 16
    canvas.height = (map.height - firstFloorRow) * 16
    const ctx = canvas.getContext('2d')!
    for (let ty = firstFloorRow; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        let g = tileAt(chao, tx, ty)
        if (wallTiles.has(g)) g = tileAt(chao, tx, ty + 1)
        if (g >= 0 && !wallTiles.has(g)) ctx.drawImage(this.tex.tileCanvas(g), tx * 16, (ty - firstFloorRow) * 16)
        if (tileAt(moveis, tx, ty) === TILES.tapete) ctx.drawImage(this.tex.tileCanvas(TILES.tapete), tx * 16, (ty - firstFloorRow) * 16)
      }
    }
    const floorTex = new THREE.CanvasTexture(canvas)
    floorTex.magFilter = floorTex.minFilter = THREE.NearestFilter
    floorTex.generateMipmaps = false
    floorTex.colorSpace = THREE.SRGBColorSpace
    hall.add(this.floor(0, firstFloorRow, map.width, map.height - firstFloorRow, new THREE.MeshLambertMaterial({ map: floorTex })))

    // Parede do fundo, com janelas, porta da rua e quadro na frente.
    for (let tx = 0; tx < map.width; tx++) {
      const face = tileAt(chao, tx, 1)
      hall.add(this.wall(tx, 0, 1, 1, face >= 0 ? this.tex.tile(face) : null))
    }

    // Móveis do mapa.
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        const raw = moveis[ty * map.width + tx] ?? 0
        const g = (raw & GID_MASK) - 1
        if (g < 0) continue
        const cx = tx + 0.5
        const cz = ty + 0.5
        switch (g) {
          case TILES.paredeLado: {
            // Encostada na parede do fundo: sobe até ela.
            const reach = wallTiles.has(tileAt(chao, tx, ty - 1)) && tileAt(moveis, tx, ty - 1) < 0 ? 1 : 0
            hall.add(this.wall(tx, ty - reach, 1, 1 + reach, null))
            break
          }
          case TILES.batente:
            // Vão de porta: só a verga em cima (uma por porta, no tile de cima).
            if (tileAt(moveis, tx, ty - 1) !== TILES.batente) hall.add(box(1, 0.3, 2, mat(wallColor), [cx, WALL_H - 0.15, ty + 1]))
            break
          case TILES.estante:
            hall.add(this.cabinet(cx, ty, 1.25, g))
            break
          case TILES.fichario:
            hall.add(this.cabinet(cx, ty, 0.95, g))
            break
          case TILES.cafeteira:
            hall.add(this.cabinet(cx, ty, 0.8, g))
            hall.add(box(0.35, 0.4, 0.3, mat('#2c2f3a'), [cx, 1.0, ty + 0.3]))
            break
          case TILES.planta:
            hall.add(this.plant(cx, cz))
            break
          case TILES.sofaE:
          case TILES.sofaD:
            hall.add(this.sofa(cx, cz))
            break
        }
      }
    }

    // Portaria com o malote: os office boys de MCP fazem fila na frente dela.
    this.portaria = at('portaria')
    const pc = at3(this.portaria)
    hall.add(box(2, 0.95, 0.9, mat('#8b5e3c'), [pc.x, 0.475, pc.z - 0.6]))
    hall.add(box(2.1, 0.08, 1.0, mat('#5c3d26'), [pc.x, 0.99, pc.z - 0.6]))
    hall.add(box(0.5, 0.35, 0.3, mat('#6b4226'), [pc.x + 0.5, 1.2, pc.z - 0.7]))
    hall.add(box(0.12, 0.08, 0.32, mat('#e8c35b'), [pc.x + 0.5, 1.4, pc.z - 0.7]))
    const sign = label('Portaria', 'placa-hall portaria')
    sign.obj.position.set(pc.x, 1.75, pc.z - 0.6)
    hall.add(sign.obj)
    this.hallObstacles.push({ x: this.portaria.x - 32, y: this.portaria.y - 40, w: 64, h: 40 })

    this.buildBoard(hall)

    const plate = at('placa-sala-do-ceo')
    const ceoSign = label('Sala do CEO', 'placa-hall ceo')
    ceoSign.obj.position.set(plate.x * U + 1.6, WALL_H + 0.2, 1)
    hall.add(ceoSign.obj)

    // A mesa do CEO (você está andando por aí) com o computador da caixa de entrada.
    this.ceoDesk = at('sala-do-ceo')
    this.hallObstacles.push({ x: this.ceoDesk.x - 48, y: this.ceoDesk.y - 30, w: 96, h: 66 })
    this.buildCeoDesk(hall, this.ceoDesk)
    this.markShadows(hall)
  }

  /** Um piso de `w`×`h` tiles com o canto em (x, z), em unidades. */
  private floor(x: number, z: number, w: number, h: number, material: THREE.Material): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material)
    m.rotation.x = -Math.PI / 2
    m.position.set(x + w / 2, 0, z + h / 2)
    m.receiveShadow = true
    return m
  }

  /** Um bloco de parede de `w`×`d` tiles com o canto em (x, z); `face` é a textura da frente (sul). */
  private wall(x: number, z: number, w: number, d: number, face: THREE.Texture | null, h = WALL_H): THREE.Mesh {
    const side = mat(wallColor)
    const front = face ? new THREE.MeshLambertMaterial({ map: face }) : side
    // Ordem das faces da caixa: +x, -x, +y (topo), -y, +z (frente), -z.
    return box(w, h, d, [side, side, mat(wallTop), side, front, side], [x + w / 2, h / 2, z + d / 2])
  }

  /** Um móvel encostado na parede (estante, fichário, balcão do café) com o tile na frente. */
  private cabinet(cx: number, ty: number, h: number, tile: number): THREE.Mesh {
    const wood = mat('#7a5232')
    return box(0.9, h, 0.55, [wood, wood, mat('#8b5e3c'), wood, new THREE.MeshLambertMaterial({ map: this.tex.tile(tile) }), wood], [cx, h / 2, ty + 0.3])
  }

  private plant(cx: number, cz: number): THREE.Group {
    const g = new THREE.Group()
    g.position.set(cx, 0, cz)
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.35, 10), mat('#b5651d'))
    pot.position.y = 0.175
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0), mat('#4caf50'))
    leaves.position.y = 0.62
    const top = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), mat('#2f7d32'))
    top.position.set(0.08, 0.88, 0.05)
    g.add(pot, leaves, top)
    return g
  }

  private sofa(cx: number, cz: number): THREE.Group {
    const g = new THREE.Group()
    g.position.set(cx, 0, cz)
    const fabric = mat('#a33f3f')
    g.add(box(1.0, 0.35, 0.8, fabric, [0, 0.2, 0]))
    g.add(box(1.0, 0.45, 0.22, mat('#7a2e2e'), [0, 0.55, -0.3]))
    return g
  }

  private buildCeoDesk(hall: THREE.Group, at: Point): void {
    const g = new THREE.Group()
    g.position.copy(at3(at))
    // Mesa grande de madeira escura, cadeira de couro e a placa "CEO".
    g.add(box(2.6, 0.08, 1.2, mat('#5c3d26'), [0, 0.7, -0.2]))
    g.add(box(2.6, 0.62, 0.08, mat('#4a3320'), [0, 0.35, 0.36]))
    for (const dx of [-1.2, 1.2]) g.add(box(0.12, 0.66, 1.1, mat('#4a3320'), [dx, 0.33, -0.2]))
    g.add(box(0.6, 0.08, 0.55, mat('#1d1f27'), [0, 0.42, -1.1]))
    g.add(box(0.6, 0.75, 0.1, mat('#1d1f27'), [0, 0.8, -1.38]))
    g.add(box(0.5, 0.12, 0.05, mat('#e8c35b'), [0.7, 0.8, 0.12]))

    // Computador virado para quem chega: a tela mostra o envelope quando há email.
    const monitor = new THREE.Group()
    monitor.position.set(-0.55, 0.74, -0.3)
    monitor.add(box(0.1, 0.18, 0.1, mat('#2c2f3a'), [0, 0.09, 0]))
    monitor.add(box(0.8, 0.6, 0.06, mat('#14151a'), [0, 0.48, 0]))
    this.ceoScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.54), new THREE.MeshBasicMaterial({ map: this.tex.screen('desligado') }))
    this.ceoScreen.position.set(0, 0.48, 0.031)
    monitor.add(this.ceoScreen)
    monitor.userData.pick = () => this.onSelect({ kind: 'inbox' })
    monitor.userData.hover = () => {}
    this.pickables.push(monitor)
    g.add(monitor)

    const badge = label('', 'contador', () => this.onSelect({ kind: 'inbox' }))
    badge.obj.position.set(-0.2, 1.45, -0.3)
    this.badge = badge.el
    g.add(badge.obj)
    hall.add(g)
    this.setInbox(this.inboxState.unread, this.inboxState.total)
  }

  /**
   * Quadro de entregas: um quadro branco de pé no hall com os PRs, artefatos e commits de
   * toda a casa. Clicar abre a lista com os links. Um PR novo faz o quadro balançar.
   */
  private buildBoard(hall: THREE.Group): void {
    const root = new THREE.Group()
    root.position.copy(at3(BOARD_AT))
    const w = BOARD_W * U
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 300
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4
    const wood = mat('#6b4a2b')
    for (const dx of [-w / 2 + 0.12, w / 2 - 0.12]) root.add(box(0.07, 1.9, 0.07, wood, [dx, 0.95, -0.05]))
    const frame = box(w, 1.25, 0.08, mat('#8b5a2b'), [0, 1.3, 0])
    root.add(frame)
    const white = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.14, 1.12), new THREE.MeshBasicMaterial({ map: texture }))
    white.position.set(0, 1.3, 0.045)
    root.add(white)
    root.userData.pick = () => this.onSelect({ kind: 'entregas' })
    root.userData.hover = (on: boolean) => (frame.material = mat(on ? '#e8c35b' : '#8b5a2b'))
    this.pickables.push(root)
    hall.add(root)
    this.board = { root, canvas, texture }
    this.hallObstacles.push({ x: BOARD_AT.x - BOARD_W / 2, y: BOARD_AT.y - 12, w: BOARD_W, h: 24 })
    this.paintBoard()
  }

  /** Atualiza o quadro de entregas. `prs` é o total de PRs: quando aumenta, o quadro balança. */
  setBoard(lines: string[], prs: number, empty: boolean): void {
    const grew = this.boardSeen && prs > this.boardState.prs
    this.boardSeen = true
    this.boardState = { lines, prs, empty }
    this.paintBoard()
    const root = this.board?.root
    if (grew && root) this.clock.tween(0.9, (k) => (root.rotation.z = Math.sin(k * Math.PI * 8) * 0.07 * (1 - k)))
  }

  private paintBoard(): void {
    if (!this.board) return
    const { canvas, texture } = this.board
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#f4f1e8'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#3fb950'
    ctx.fillRect(0, 0, canvas.width, 64)
    ctx.fillStyle = '#1d1f27'
    ctx.font = 'bold 40px -apple-system, "Segoe UI", system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.fillText('Entregas', 22, 34)
    ctx.fillStyle = this.boardState.empty ? '#8a8f9c' : '#2a2d36'
    ctx.font = 'bold 40px -apple-system, "Segoe UI", system-ui, sans-serif'
    this.boardState.lines.slice(0, 3).forEach((line, i) => ctx.fillText(line, 22, 112 + i * 64, canvas.width - 40))
    texture.needsUpdate = true
  }

  /** Atualiza o computador do CEO: `unread` emails não lidos de `total` na caixa. */
  setInbox(unread: number, total: number): void {
    this.inboxState = { unread, total }
    if (!this.ceoScreen || !this.badge) return
    this.ceoScreen.material.map = this.tex.screen(total > 0 ? 'email' : 'desligado')
    this.badge.textContent = unread > 99 ? '99+' : String(unread)
    this.badge.hidden = unread === 0
  }

  private markShadows(o: THREE.Object3D): void {
    o.traverse((c) => {
      if (c instanceof THREE.Mesh && !(c.material instanceof THREE.MeshBasicMaterial)) {
        c.castShadow = true
        c.receiveShadow = true
      }
    })
  }

  // ------------------------------------------------------------------ sessões

  /** Marca a mesa aberta no painel (ou nenhuma). */
  select(sel: Selection | null): void {
    this.selection = sel
    for (const [id, desk] of this.desks) desk.setSelected(sel?.kind === 'session' && sel.id === id)
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

  private refreshDesks(): void {
    for (const [id, desk] of this.desks) {
      const s = this.sessions.get(id)
      if (s) desk.update(s)
    }
  }

  /** Um cômodo: chão, parede de cima com o nome, paredes laterais e a porta para o corredor. */
  private drawRoom(group: THREE.Group, room: Room): void {
    const t = TILE
    const x = room.x / t
    const y = room.y / t
    const w = room.w / t
    const h = room.h / t
    const floorY = room.floorY / t
    // A parede de cima tem um tile de espessura; a linha logo abaixo dela já é chão.
    const top = y + 1
    const floorH = y + h - top
    group.add(this.floor(x + 1, top, w - 2, floorH, new THREE.MeshLambertMaterial({ map: this.tex.tile(room.key ? TILES.carpete : TILES.carpeteB, w - 2, floorH) })))
    group.add(this.wall(x, y, w, 1, this.tex.tile(TILES.parede, w, 1)))

    const outerX = room.side === 'esquerda' ? x : x + w - 1
    const innerX = room.side === 'esquerda' ? x + w - 1 : x
    group.add(this.wall(outerX, top, 1, floorH, null))
    // Porta para o corredor: vão nas duas primeiras linhas do chão, com a verga em cima.
    if (floorY > top) group.add(this.wall(innerX, top, 1, floorY - top, null))
    group.add(box(1, 0.3, 2, mat(wallColor), [innerX + 0.5, WALL_H - 0.15, floorY + 1]))
    const below = y + h - (floorY + 2)
    if (below > 0) group.add(this.wall(innerX, floorY + 2, 1, below, null))
    // Capacho no corredor, em frente à porta.
    const matX = room.side === 'esquerda' ? x + w : x - 1
    const mat3 = this.floor(matX, floorY + 0.5, 1, 1, new THREE.MeshLambertMaterial({ map: this.tex.tile(TILES.tapete) }))
    mat3.position.y = 0.01
    group.add(mat3)

    const key = room.key
    const sign = label(key ? `Ala ${room.name}` : room.name, key ? 'placa-ala' : 'placa-ala livre', key ? () => this.onSelect({ kind: 'room', key }) : undefined)
    sign.obj.position.set(x + w / 2, WALL_H + 0.25, y + 1)
    group.add(sign.obj)
    if (key) {
      const people = document.createElement('span')
      people.className = 'pessoas'
      sign.el.append(people)
      this.roomLabels.set(key, people)
    } else {
      // Sala livre: só uma planta e um sofá esperando o próximo projeto.
      group.add(this.plant(x + 1.6, floorY + 0.6))
      group.add(this.sofa(x + w / 2 - 0.5, floorY + 1.4), this.sofa(x + w / 2 + 0.5, floorY + 1.4))
    }
  }

  /** Agrupa por projeto, ordena por branch e redistribui cômodos e mesas pela casa. */
  private layout(): void {
    if (!this.ready) return

    for (const [id, desk] of this.desks) {
      if (!this.sessions.has(id)) {
        desk.leave()
        this.desks.delete(id)
        const i = this.pickables.indexOf(desk.root)
        if (i >= 0) this.pickables.splice(i, 1)
      }
    }

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
    this.plan = plan
    const { width } = this.frame

    // As paredes só são refeitas quando a planta muda (um cômodo ou uma mesa a mais ou a menos).
    const key = JSON.stringify(plan.rooms.map((r) => [r.key, r.name, r.x, r.y, r.w, r.h]))
    if (key !== this.houseKey) {
      this.houseKey = key
      dispose(this.house)
      this.house = new THREE.Group()
      this.world.add(this.house)
      this.roomLabels.clear()
      for (const room of plan.rooms) this.drawRoom(this.house, room)
      // Corredor central e parede de baixo.
      if (plan.corridor.h > 0) {
        const c = plan.corridor
        this.house.add(this.floor(c.x / TILE, c.y / TILE, c.w / TILE, c.h / TILE, new THREE.MeshLambertMaterial({ map: this.tex.tile(TILES.piso, c.w / TILE, c.h / TILE) })))
      }
      this.house.add(this.wall(0, plan.bottom / TILE, width / TILE, 1, null))
      this.markShadows(this.house)
    }
    for (const [k, list] of byProject) {
      const el = this.roomLabels.get(k)
      if (el) el.textContent = roomPeople(list)
    }

    // Grade de caminhada: paredes do hall e dos cômodos, portas, corredor e móveis.
    this.nav = buildNav({
      map: mapa as HallMap,
      tiles: TILES,
      tile: TILE,
      width,
      hallHeight: this.frame.hallHeight,
      plan,
      obstacles: [...this.hallObstacles, ...plan.rooms.flatMap((r) => r.desks.map(deskObstacle))]
    })
    this.boys?.setNav(this.nav)
    // Uma mesa nova apareceu onde o CEO estava: ele dá um passo para o lado.
    if (!canStand(this.nav, this.ceoAt, CEO_RADIUS)) {
      const free = this.nav.nearestFree(this.ceoAt, 20)
      if (free) {
        this.ceoAt = free
        this.ceo.root.position.copy(at3(free))
      }
    }

    for (const room of plan.rooms) {
      const list = room.key ? byProject.get(room.key)! : []
      list.forEach((s, i) => {
        const at = room.desks[i]!
        let desk = this.desks.get(s.id)
        if (!desk) {
          const id = s.id
          desk = new Desk(this.clock, this.tex, this.world, at.x, at.y, room.route, () => this.onSelect({ kind: 'session', id }))
          desk.root.userData.hover = (on: boolean) => desk!.setHover(on)
          desk.setSelected(this.selection?.kind === 'session' && this.selection.id === id)
          this.world.add(desk.root)
          this.pickables.push(desk.root)
          this.desks.set(s.id, desk)
        }
        desk.setRoute(room.route)
        desk.setNav(this.nav!)
        desk.moveTo(at.x, at.y)
        desk.update(s)
      })
    }

    if (this.emptyLabel) dispose(this.emptyLabel)
    this.emptyLabel = null
    if (projects.length === 0) {
      const empty = label('Casa vazia. Abra uma sessão do Claude Code para contratar alguém.', 'vazia')
      empty.obj.position.set(width / 2 / TILE, 0.5, plan.height / TILE + 1.5)
      this.world.add(empty.obj)
      this.emptyLabel = empty.obj
    }
    this.boys?.sync([...this.sessions.values()], (id) => this.desks.get(id)?.anchor() ?? null)
  }
}
