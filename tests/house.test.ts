import { describe, expect, it } from 'vitest'
import { planHouse, type HouseFrame } from '../src/renderer/src/house'

const TILE = 32
const frame: HouseFrame = { tile: TILE, width: 40 * TILE, hallHeight: 6 * TILE, corridor: { x: 18 * TILE, w: 4 * TILE }, frontDoor: { x: 136, y: 104 } }
const desk = { w: 224, h: 176, gap: 16, pad: 16, perRow: 2 }
const rooms = (...desks: number[]) => desks.map((n, i) => ({ key: `p${i}`, name: `p${i}`, desks: n }))

describe('planHouse', () => {
  it('casa vazia: só o hall e a parede de baixo', () => {
    const plan = planHouse(frame, [], desk)
    expect(plan.rooms).toEqual([])
    expect(plan.bottom).toBe(frame.hallHeight)
    expect(plan.corridor.h).toBe(0)
  })

  it('põe os cômodos aos pares, dos dois lados do corredor, e completa o par com uma sala livre', () => {
    const plan = planHouse(frame, rooms(1, 3, 2), desk)
    expect(plan.rooms.map((r) => [r.key, r.side])).toEqual([
      ['p0', 'esquerda'],
      ['p1', 'direita'],
      ['p2', 'esquerda'],
      [null, 'direita']
    ])
    const [a, b, c] = plan.rooms
    // Os dois cômodos de um par têm a mesma altura e o par de baixo começa onde o de cima acaba.
    expect(a!.h).toBe(b!.h)
    expect(c!.y).toBe(a!.y + a!.h)
    expect(a!.x + a!.w).toBe(frame.corridor.x)
    expect(b!.x).toBe(frame.corridor.x + frame.corridor.w)
    // O corredor desce do hall até a parede de baixo.
    expect(plan.corridor).toEqual({ x: frame.corridor.x, y: frame.hallHeight, w: frame.corridor.w, h: plan.bottom - frame.hallHeight })
  })

  it('cada mesa cabe dentro do seu cômodo, sem encostar nas paredes laterais', () => {
    for (const room of planHouse(frame, rooms(5, 2), desk).rooms) {
      for (const d of room.desks) {
        expect(d.x).toBeGreaterThanOrEqual(room.x + TILE)
        expect(d.x + desk.w).toBeLessThanOrEqual(room.x + room.w - TILE)
        expect(d.y).toBeGreaterThanOrEqual(room.floorY)
        expect(d.y + desk.h).toBeLessThanOrEqual(room.y + room.h)
      }
    }
  })

  it('o caminho sai da porta da rua, desce pelo corredor e entra pela porta do cômodo', () => {
    const [left, right] = planHouse(frame, rooms(1, 1), desk).rooms
    for (const room of [left!, right!]) {
      const [start, hall, corridor, door, inside] = room.route
      expect(start).toEqual(frame.frontDoor)
      const mid = frame.corridor.x + frame.corridor.w / 2
      expect(hall!.x).toBe(mid)
      expect(hall!.y).toBeLessThan(frame.hallHeight)
      expect(corridor!.x).toBe(mid)
      expect(door!.x).toBe(room.door.x)
      expect(door!.y).toBe(corridor!.y)
      // Depois da porta, o ponto fica dentro do cômodo.
      expect(inside!.x).toBeGreaterThan(room.x)
      expect(inside!.x).toBeLessThan(room.x + room.w)
    }
    expect(left!.door.x).toBeGreaterThan(left!.x + left!.w - TILE)
    expect(right!.door.x).toBeLessThan(right!.x + TILE)
  })
})
