import { describe, expect, it } from 'vitest'
import { planHouse, TEAM, teamObstacle, teamSpots, type HouseFrame } from '../src/renderer/src/house'

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

  it('cada cômodo com projeto tem uma mesa da equipe embaixo das mesas, dentro do cômodo', () => {
    const plan = planHouse(frame, rooms(3, 1), desk)
    for (const room of plan.rooms) {
      const t = teamObstacle(room.team!)
      for (const d of room.desks) expect(t.y).toBeGreaterThan(d.y + desk.h)
      expect(t.x).toBeGreaterThanOrEqual(room.x + TILE)
      expect(t.x + t.w).toBeLessThanOrEqual(room.x + room.w - TILE)
      // Sobra lugar para as cadeiras e para passar embaixo dela.
      for (const s of teamSpots(room.team!)) expect(s.y).toBeLessThan(room.y + room.h - 8)
    }
    expect(planHouse(frame, rooms(1), desk).rooms[1]!.team).toBeNull()
  })
})

describe('teamSpots', () => {
  const c = { x: 300, y: 500 }
  const spots = teamSpots(c)

  it('enche primeiro as cadeiras do lado de cima, do meio para as pontas, e depois as de baixo', () => {
    const seats = spots.filter((s) => s.sit)
    expect(seats).toHaveLength(TEAM.perSide * 2)
    expect(spots.slice(0, seats.length).every((s) => s.sit)).toBe(true)
    const top = seats.slice(0, TEAM.perSide)
    expect(top.every((s) => s.y < c.y)).toBe(true)
    expect(seats.slice(TEAM.perSide).every((s) => s.y > c.y)).toBe(true)
    const dist = top.map((s) => Math.abs(s.x - c.x))
    expect(dist).toEqual([...dist].sort((a, b) => a - b))
  })

  it('ninguém fica dentro do tampo, todo mundo olha para a mesa e não há dois no mesmo lugar', () => {
    const t = teamObstacle(c)
    const keys = new Set(spots.map((s) => `${s.x},${s.y}`))
    expect(keys.size).toBe(spots.length)
    for (const s of spots) {
      const inside = s.x > t.x && s.x < t.x + t.w && s.y > t.y && s.y < t.y + t.h
      expect(inside).toBe(false)
      // Olhar para `face` é olhar na direção do tampo.
      const fx = s.face.x - s.x
      const fy = s.face.y - s.y
      expect(Math.sign(fx) * Math.sign(c.x - s.x) >= 0 && Math.sign(fy) * Math.sign(c.y - s.y) >= 0).toBe(true)
    }
  })
})
