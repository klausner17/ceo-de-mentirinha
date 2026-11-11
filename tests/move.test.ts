import { describe, expect, it } from 'vitest'
import { NavGrid } from '../src/renderer/src/nav'
import { canStand, direction, nearest, walk } from '../src/renderer/src/move'

/** Sala de 320×320 com uma parede vertical em x 160..176, de y 0 a 240 (passagem embaixo). */
function room(): NavGrid {
  const nav = new NavGrid(320, 320, 16)
  nav.block({ x: 160, y: 0, w: 16, h: 240 })
  return nav
}

describe('andar do CEO', () => {
  it('anda livre onde não há parede', () => {
    expect(walk(room(), { x: 40, y: 40 }, 30, 20, 8)).toEqual({ x: 70, y: 60 })
  })

  it('não atravessa parede, nem com passo grande', () => {
    const at = walk(room(), { x: 100, y: 100 }, 200, 0, 8)
    expect(at.x).toBeLessThan(160 - 8 + 0.01)
    expect(canStand(room(), at, 8)).toBe(true)
  })

  it('escorrega pela parede quando anda na diagonal', () => {
    const at = walk(room(), { x: 148, y: 100 }, 20, 20, 8)
    expect(at.x).toBeLessThan(152)
    expect(at.y).toBe(120)
  })

  it('não sai da casa', () => {
    const at = walk(room(), { x: 20, y: 20 }, -100, -100, 8)
    expect(at.x).toBeGreaterThanOrEqual(8)
    expect(at.y).toBeGreaterThanOrEqual(8)
  })

  it('desliza para dentro de uma porta quando chega um pouco desalinhado', () => {
    // Parede vertical com porta de 64 px (y 128..192).
    const nav = new NavGrid(320, 320, 16)
    nav.block({ x: 160, y: 0, w: 16, h: 128 })
    nav.block({ x: 160, y: 192, w: 16, h: 128 })
    let at = { x: 120, y: 200 }
    for (let i = 0; i < 40; i++) at = walk(nav, at, 5, 0, 9)
    expect(at.x).toBeGreaterThan(200)
    expect(at.y).toBeLessThanOrEqual(192 - 9)
  })

  it('passa pela abertura embaixo da parede', () => {
    const at = walk(room(), { x: 140, y: 280 }, 100, 0, 8)
    expect(at).toEqual({ x: 240, y: 280 })
  })
})

describe('direção das teclas', () => {
  const none = { up: false, down: false, left: false, right: false }
  const close = (p: { x: number; y: number }) => ({ x: Math.round(p.x * 1000) / 1000 + 0, y: Math.round(p.y * 1000) / 1000 + 0 })

  it('com a câmera ao sul, cima vai para o norte e direita para o leste', () => {
    expect(close(direction({ ...none, up: true }, 0))).toEqual({ x: 0, y: -1 })
    expect(close(direction({ ...none, right: true }, 0))).toEqual({ x: 1, y: 0 })
  })

  it('segue a câmera girada', () => {
    // Câmera a leste olhando para oeste: frente é oeste.
    expect(close(direction({ ...none, up: true }, Math.PI / 2))).toEqual({ x: -1, y: 0 })
  })

  it('diagonal tem tamanho 1 e sem tecla fica parado', () => {
    const d = direction({ ...none, up: true, right: true }, 0)
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1)
    expect(direction(none, 0)).toEqual({ x: 0, y: 0 })
  })
})

describe('alvo mais perto', () => {
  it('escolhe o mais perto dentro do alcance', () => {
    const targets = [
      { id: 'a', at: { x: 0, y: 0 } },
      { id: 'b', at: { x: 30, y: 0 } },
      { id: 'c', at: { x: 300, y: 0 } }
    ]
    expect(nearest(targets, { x: 20, y: 0 }, 50)?.id).toBe('b')
    expect(nearest(targets, { x: 200, y: 0 }, 50)).toBeNull()
  })
})
