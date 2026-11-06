import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { planHouse, type HouseFrame } from '../src/renderer/src/house'
import { buildNav, NavGrid, type HallMap, type Rect } from '../src/renderer/src/nav'

const TILE = 32
const map = JSON.parse(readFileSync(join(__dirname, '..', 'assets', 'mapa', 'escritorio.json'), 'utf8')) as HallMap
const corridor = (map.layers.find((l) => l.name === 'pontos') as unknown as { objects: Array<{ name: string; x: number; width: number }> }).objects.find((o) => o.name === 'corredor')!
const frame: HouseFrame = {
  tile: TILE,
  width: map.width * TILE,
  hallHeight: map.height * TILE,
  corridor: { x: corridor.x * 2, w: corridor.width * 2 },
  frontDoor: { x: 4 * TILE + TILE / 2, y: 3 * TILE }
}
const deskSize = { w: 224, h: 176, gap: 16, pad: 16, perRow: 2 }
const TILES = { paredeTopo: 3, parede: 4, porta: 5, janela: 6, quadro: 14, tapete: 7, batente: 17 }
const deskRect = (d: { x: number; y: number }): Rect => ({ x: d.x + 60, y: d.y + 46, w: 104, h: 74 })

function house(...desks: number[]) {
  const plan = planHouse(frame, desks.map((n, i) => ({ key: `p${i}`, name: `p${i}`, desks: n })), deskSize)
  const obstacles = plan.rooms.flatMap((r) => r.desks.map(deskRect))
  const nav = buildNav({ map, tiles: TILES, tile: TILE, width: frame.width, hallHeight: frame.hallHeight, plan, obstacles })
  return { plan, nav, obstacles }
}

/** Todo trecho do caminho passa só por células livres. */
function expectWalkable(nav: NavGrid, from: { x: number; y: number }, path: Array<{ x: number; y: number }>) {
  let prev = nav.nearestFree(from)!
  for (const p of path) {
    expect(nav.lineOfSight(prev, p)).toBe(true)
    prev = p
  }
}

describe('NavGrid', () => {
  it('desvia de um obstáculo no meio do caminho', () => {
    const nav = new NavGrid(320, 320, 16)
    nav.block({ x: 96, y: 0, w: 32, h: 256 })
    const path = nav.findPath({ x: 40, y: 40 }, { x: 280, y: 40 })!
    expectWalkable(nav, { x: 40, y: 40 }, path)
    // Tem que descer até abaixo da parede para dar a volta.
    expect(Math.max(...path.map((p) => p.y))).toBeGreaterThan(256)
    expect(path.at(-1)).toEqual({ x: 280, y: 40 })
  })

  it('devolve null quando não há passagem', () => {
    const nav = new NavGrid(320, 320, 16)
    nav.block({ x: 96, y: 0, w: 32, h: 320 })
    expect(nav.findPath({ x: 40, y: 40 }, { x: 280, y: 40 })).toBeNull()
  })

  it('troca destino dentro de obstáculo pela célula livre mais próxima', () => {
    const nav = new NavGrid(320, 320, 16)
    nav.block({ x: 160, y: 160, w: 64, h: 64 })
    const end = nav.findPath({ x: 20, y: 20 }, { x: 190, y: 190 })!.at(-1)!
    expect(nav.isFree(end)).toBe(true)
  })
})

describe('buildNav', () => {
  it('paredes, janelas e móveis do hall bloqueiam; o chão do hall não', () => {
    const { nav } = house(1)
    expect(nav.isFree({ x: 5 * TILE, y: 0.5 * TILE })).toBe(false) // parede de cima
    expect(nav.isFree({ x: 9.5 * TILE, y: 2.5 * TILE })).toBe(false) // estante
    expect(nav.isFree({ x: 5.5 * TILE, y: 4.5 * TILE })).toBe(true) // chão do hall
  })

  it('do hall até dentro de um cômodo, o caminho passa pela porta e não atravessa parede nem mesa', () => {
    const { plan, nav, obstacles } = house(2, 1)
    for (const room of plan.rooms) {
      const target = { x: room.desks[0]!.x + 20, y: room.desks[0]!.y + 70 } // ao lado da mesa
      const from = { x: 7 * TILE, y: 4 * TILE } // frente da portaria
      const path = nav.findPath(from, target)!
      expect(path).not.toBeNull()
      expectWalkable(nav, from, path)
      // Algum trecho cruza a coluna da porta, na altura da porta.
      const doorTop = room.floorY
      const crosses = [nav.nearestFree(from)!, ...path].some((p, i, all) => {
        const q = all[i + 1]
        if (!q) return false
        const t = (room.door.x - p.x) / (q.x - p.x)
        if (!(t >= 0 && t <= 1)) return false
        const y = p.y + (q.y - p.y) * t
        return y >= doorTop && y <= doorTop + 2 * TILE
      })
      expect(crosses).toBe(true)
      // Nenhum ponto do caminho fica dentro de uma mesa.
      for (const p of path) {
        for (const o of obstacles) expect(p.x > o.x && p.x < o.x + o.w && p.y > o.y && p.y < o.y + o.h).toBe(false)
      }
    }
  })

  it('a parede entre dois cômodos vizinhos não tem passagem direta', () => {
    const { plan, nav } = house(1, 1)
    const [left, right] = plan.rooms
    // Bem perto da parede do corredor, mas abaixo da porta: precisa voltar pela porta.
    const a = { x: left!.x + left!.w - 1.5 * TILE, y: left!.floorY + 3.5 * TILE }
    const b = { x: right!.x + 1.5 * TILE, y: right!.floorY + 3.5 * TILE }
    expect(nav.lineOfSight(a, b)).toBe(false)
    const path = nav.findPath(a, b)!
    expectWalkable(nav, a, path)
    expect(Math.min(...path.map((p) => p.y))).toBeLessThan(left!.floorY + 2 * TILE)
  })
})
