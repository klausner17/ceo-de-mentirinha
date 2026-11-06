// Grade de caminhada da casa: diz onde dá para pisar (chão, corredor, portas) e onde não
// dá (paredes e móveis), e acha caminhos com A*. Os office boys e os liderados andam por
// ela em vez de atravessar paredes. Só faz contas: não depende do Phaser, para dar para testar.

import type { HousePlan, Point } from './house'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** O que importa do mapa do Tiled para saber onde há parede e móvel no hall. */
export interface HallMap {
  width: number
  height: number
  layers: Array<{ name: string; type: string; data?: number[] }>
}

/** Bits de espelhamento que o Tiled guarda no gid. */
const GID_MASK = 0x1fffffff

const SQRT2 = Math.SQRT2

export class NavGrid {
  readonly cols: number
  readonly rows: number
  private readonly blocked: Uint8Array

  constructor(
    readonly width: number,
    readonly height: number,
    /** Lado de uma célula, em pixels da tela. */
    readonly cell: number
  ) {
    this.cols = Math.ceil(width / cell)
    this.rows = Math.ceil(height / cell)
    this.blocked = new Uint8Array(this.cols * this.rows)
  }

  private fill(r: Rect, value: 0 | 1): void {
    const c0 = Math.max(0, Math.floor(r.x / this.cell))
    const r0 = Math.max(0, Math.floor(r.y / this.cell))
    const c1 = Math.min(this.cols, Math.ceil((r.x + r.w) / this.cell))
    const r1 = Math.min(this.rows, Math.ceil((r.y + r.h) / this.cell))
    for (let row = r0; row < r1; row++) this.blocked.fill(value, row * this.cols + c0, row * this.cols + c1)
  }

  block(r: Rect): void {
    this.fill(r, 1)
  }

  open(r: Rect): void {
    this.fill(r, 0)
  }

  private inside(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows
  }

  private freeCell(c: number, r: number): boolean {
    return this.inside(c, r) && this.blocked[r * this.cols + c] === 0
  }

  isFree(p: Point): boolean {
    return this.freeCell(Math.floor(p.x / this.cell), Math.floor(p.y / this.cell))
  }

  private center(c: number, r: number): Point {
    return { x: (c + 0.5) * this.cell, y: (r + 0.5) * this.cell }
  }

  /** A célula livre mais próxima do ponto (busca em anéis crescentes). */
  nearestFree(p: Point, maxRadius = 12): Point | null {
    const c0 = Math.floor(p.x / this.cell)
    const r0 = Math.floor(p.y / this.cell)
    if (this.freeCell(c0, r0)) return p
    for (let radius = 1; radius <= maxRadius; radius++) {
      let best: Point | null = null
      let bestD = Infinity
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius || !this.freeCell(c0 + dc, r0 + dr)) continue
          const q = this.center(c0 + dc, r0 + dr)
          const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2
          if (d < bestD) {
            bestD = d
            best = q
          }
        }
      }
      if (best) return best
    }
    return null
  }

  /** O segmento passa só por células livres? */
  lineOfSight(a: Point, b: Point): boolean {
    const dist = Math.hypot(b.x - a.x, b.y - a.y)
    const steps = Math.max(1, Math.ceil(dist / (this.cell / 4)))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      if (!this.isFree({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return false
    }
    return true
  }

  /**
   * Caminho de `from` até `to` desviando de paredes e móveis. Devolve os pontos a visitar
   * (sem o ponto de partida, terminando no destino), ou null se não houver caminho.
   * Pontos dentro de obstáculos são trocados pela célula livre mais próxima.
   */
  findPath(from: Point, to: Point): Point[] | null {
    const start = this.nearestFree(from)
    const goal = this.nearestFree(to)
    if (!start || !goal) return null
    const sc = Math.floor(start.x / this.cell)
    const sr = Math.floor(start.y / this.cell)
    const gc = Math.floor(goal.x / this.cell)
    const gr = Math.floor(goal.y / this.cell)

    const n = this.cols * this.rows
    const g = new Float64Array(n).fill(Infinity)
    const parent = new Int32Array(n).fill(-1)
    const closed = new Uint8Array(n)
    const heap = new MinHeap()
    const h = (c: number, r: number) => {
      const dx = Math.abs(c - gc)
      const dy = Math.abs(r - gr)
      return dx + dy + (SQRT2 - 2) * Math.min(dx, dy)
    }
    const startIdx = sr * this.cols + sc
    const goalIdx = gr * this.cols + gc
    g[startIdx] = 0
    heap.push(startIdx, h(sc, sr))

    let found = false
    while (heap.size > 0) {
      const cur = heap.pop()
      if (closed[cur]) continue
      if (cur === goalIdx) {
        found = true
        break
      }
      closed[cur] = 1
      const c = cur % this.cols
      const r = (cur - c) / this.cols
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue
          const nc = c + dc
          const nr = r + dr
          if (!this.freeCell(nc, nr)) continue
          // Na diagonal, não corta quina de parede.
          if (dr && dc && (!this.freeCell(c + dc, r) || !this.freeCell(c, r + dr))) continue
          const ni = nr * this.cols + nc
          const cost = g[cur]! + (dr && dc ? SQRT2 : 1)
          if (cost < g[ni]!) {
            g[ni] = cost
            parent[ni] = cur
            heap.push(ni, cost + h(nc, nr))
          }
        }
      }
    }
    if (!found) return null

    const cells: Point[] = []
    for (let i = goalIdx; i !== -1; i = parent[i]!) {
      const c = i % this.cols
      cells.push(this.center(c, (i - c) / this.cols))
    }
    cells.reverse()
    cells[0] = start
    cells[cells.length - 1] = goal
    return this.smooth(cells).slice(1)
  }

  /** Puxa o barbante: pula pontos intermediários quando dá para ir em linha reta. */
  private smooth(points: Point[]): Point[] {
    if (points.length <= 2) return points
    const out = [points[0]!]
    let anchor = 0
    while (anchor < points.length - 1) {
      let next = points.length - 1
      while (next > anchor + 1 && !this.lineOfSight(points[anchor]!, points[next]!)) next--
      out.push(points[next]!)
      anchor = next
    }
    return out
  }
}

/** Fila de prioridade mínima (heap binário) de índices de célula. */
class MinHeap {
  private readonly items: number[] = []
  private readonly keys: number[] = []

  get size(): number {
    return this.items.length
  }

  push(item: number, key: number): void {
    this.items.push(item)
    this.keys.push(key)
    let i = this.items.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (this.keys[p]! <= this.keys[i]!) break
      this.swap(i, p)
      i = p
    }
  }

  pop(): number {
    const top = this.items[0]!
    const lastItem = this.items.pop()!
    const lastKey = this.keys.pop()!
    if (this.items.length > 0) {
      this.items[0] = lastItem
      this.keys[0] = lastKey
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < this.items.length && this.keys[l]! < this.keys[m]!) m = l
        if (r < this.items.length && this.keys[r]! < this.keys[m]!) m = r
        if (m === i) break
        this.swap(i, m)
        i = m
      }
    }
    return top
  }

  private swap(a: number, b: number): void {
    ;[this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!]
    ;[this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!]
  }
}

export interface NavInput {
  map: HallMap
  /** Índices do tileset (o gid do Tiled é índice + 1). */
  tiles: { paredeTopo: number; parede: number; porta: number; janela: number; quadro: number; tapete: number; batente: number }
  tile: number
  width: number
  hallHeight: number
  plan: HousePlan
  /** Móveis fora do mapa: mesas, portaria, mesa do CEO. */
  obstacles: Rect[]
}

/** Monta a grade da casa: hall a partir do mapa, cômodos a partir do plano e os móveis. */
export function buildNav({ map, tiles, tile, width, hallHeight, plan, obstacles }: NavInput): NavGrid {
  const nav = new NavGrid(width, Math.max(plan.height, hallHeight), tile / 2)

  // Hall: parede no chão (topo, face, janelas, quadro, porta da rua) e qualquer móvel bloqueiam;
  // tapete e batente (vão de porta) deixam passar.
  const wallTiles = new Set([tiles.paredeTopo, tiles.parede, tiles.porta, tiles.janela, tiles.quadro].map((i) => i + 1))
  const passable = new Set([tiles.tapete, tiles.batente].map((i) => i + 1))
  const chao = map.layers.find((l) => l.name === 'chao')?.data ?? []
  const moveis = map.layers.find((l) => l.name === 'moveis')?.data ?? []
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const i = ty * map.width + tx
      const floor = (chao[i] ?? 0) & GID_MASK
      const thing = (moveis[i] ?? 0) & GID_MASK
      if (wallTiles.has(floor) || (thing !== 0 && !passable.has(thing))) nav.block({ x: tx * tile, y: ty * tile, w: tile, h: tile })
    }
  }

  // Abaixo do hall tudo é parede, menos o corredor, o chão dos cômodos e as portas.
  nav.block({ x: 0, y: hallHeight, w: width, h: nav.height - hallHeight })
  nav.open(plan.corridor)
  for (const room of plan.rooms) {
    nav.open({ x: room.x + tile, y: room.floorY, w: room.w - 2 * tile, h: room.y + room.h - room.floorY })
    // A porta ocupa as duas primeiras linhas do chão, na parede do lado do corredor.
    const doorX = room.side === 'esquerda' ? room.x + room.w - tile : room.x
    nav.open({ x: doorX, y: room.floorY, w: tile, h: 2 * tile })
  }
  for (const o of obstacles) nav.block(o)
  return nav
}
