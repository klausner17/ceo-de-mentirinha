// Peças comuns do mundo 3D: conversão entre o plano da casa (pixels, como nas contas de
// house.ts e nav.ts) e o 3D (um tile = uma unidade), materiais e texturas da pixel art,
// rótulos em HTML presos no 3D e o relógio das animações.

import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { frameCanvas, type Art, type Screen, SCREEN, TILE } from '../art'
import type { Point } from '../house'

export const FONT = '-apple-system, "Segoe UI", system-ui, sans-serif'

/** Pixels do plano da casa para unidades do 3D. */
export const U = 1 / TILE
/** Altura das paredes, em unidades. */
export const WALL_H = 1.1

/** Ponto do plano (x, y em pixels) para o 3D: x continua x, y vira z. */
export function at3(p: Point, height = 0): THREE.Vector3 {
  return new THREE.Vector3(p.x * U, height, p.y * U)
}

/** Posição de um objeto 3D de volta para o plano da casa. */
export function toPlan(o: THREE.Object3D): Point {
  return { x: o.position.x / U, y: o.position.z / U }
}

const materials = new Map<string, THREE.MeshLambertMaterial>()

/** Material de uma cor só, compartilhado. */
export function mat(color: string | number): THREE.MeshLambertMaterial {
  const key = String(color)
  let m = materials.get(key)
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color })
    materials.set(key, m)
  }
  return m
}

const boxes = new Map<string, THREE.BoxGeometry>()

/** Caixa w×h×d (largura em x, altura em y, profundidade em z) com o centro na origem. */
export function box(w: number, h: number, d: number, material: THREE.Material | THREE.Material[], at?: [number, number, number]): THREE.Mesh {
  const key = `${w}|${h}|${d}`
  let g = boxes.get(key)
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d)
    boxes.set(key, g)
  }
  const mesh = new THREE.Mesh(g, material)
  if (at) mesh.position.set(...at)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

function pixelTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas)
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** As texturas da pixel art, recortadas e guardadas por quadro. */
export class Textures {
  private readonly cache = new Map<string, THREE.Texture>()
  private readonly canvases = new Map<string, HTMLCanvasElement>()

  constructor(readonly art: Art) {}

  private canvas(sheet: keyof Art, index: number): HTMLCanvasElement {
    const key = `${sheet}:${index}`
    let c = this.canvases.get(key)
    if (!c) {
      c = frameCanvas(this.art[sheet], index)
      this.canvases.set(key, c)
    }
    return c
  }

  private get(sheet: keyof Art, index: number, repeatX = 1, repeatY = 1): THREE.Texture {
    const key = `${sheet}:${index}:${repeatX}:${repeatY}`
    let t = this.cache.get(key)
    if (!t) {
      t = pixelTexture(this.canvas(sheet, index))
      if (repeatX !== 1 || repeatY !== 1) {
        t.wrapS = t.wrapT = THREE.RepeatWrapping
        t.repeat.set(repeatX, repeatY)
      }
      this.cache.set(key, t)
    }
    return t
  }

  /** Um tile do mapa, repetido `rx`×`ry` vezes. */
  tile(index: number, rx = 1, ry = 1): THREE.Texture {
    return this.get('tiles', index, rx, ry)
  }

  screen(s: Screen): THREE.Texture {
    return this.get('monitor', SCREEN[s])
  }

  item(index: number): THREE.Texture {
    return this.get('itens', index)
  }

  /** O quadro do tile como imagem, para montar o chão do hall num canvas só. */
  tileCanvas(index: number): HTMLCanvasElement {
    return this.canvas('tiles', index)
  }
}

/** Uma figura da folha de itens que sempre olha para a câmera (Z, suor, envelope...). */
export function itemSprite(tex: Textures, index: number, size = 0.4): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.item(index), transparent: true, depthWrite: false }))
  s.scale.set(size, size, 1)
  return s
}

/**
 * Um rótulo HTML preso num ponto do 3D (sempre de frente, sempre legível). O CSS2DRenderer
 * posiciona a caixa de fora; a de dentro (`el`) é o rótulo, que encolhe com a distância da
 * câmera (variável --z) sem sair do lugar.
 */
export function label(text: string, cls: string, onClick?: () => void): { obj: CSS2DObject; el: HTMLDivElement } {
  const el = document.createElement('div')
  el.className = `rotulo ${cls}`
  el.textContent = text
  if (onClick) {
    el.classList.add('clicavel')
    el.addEventListener('pointerdown', (e) => e.stopPropagation())
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      onClick()
    })
  }
  const box = document.createElement('div')
  box.className = 'ancora'
  box.append(el)
  const obj = new CSS2DObject(box)
  return { obj, el }
}

/** Animação que roda a cada quadro até devolver true. */
export type Tick = (dt: number, time: number) => boolean | void

/** O relógio do mundo: chama as animações a cada quadro e esquece as que acabaram. */
export class Clock {
  private readonly ticks = new Set<Tick>()

  add(tick: Tick): () => void {
    this.ticks.add(tick)
    return () => this.ticks.delete(tick)
  }

  run(dt: number, time: number): void {
    for (const t of [...this.ticks]) if (t(dt, time) === true) this.ticks.delete(t)
  }

  /** Anima de 0 a 1 em `seconds` (com a curva `ease`) e chama `done` no fim. */
  tween(seconds: number, step: (k: number) => void, done?: () => void, ease: (k: number) => number = (k) => k, delay = 0): () => void {
    let t = -delay
    return this.add((dt) => {
      t += dt
      if (t < 0) return false
      const k = Math.min(1, t / seconds)
      step(ease(k))
      if (k >= 1) {
        done?.()
        return true
      }
      return false
    })
  }
}

export const easeOut = (k: number) => 1 - (1 - k) ** 3
export const easeBack = (k: number) => 1 + 2.7 * (k - 1) ** 3 + 1.7 * (k - 1) ** 2

/** Tira o objeto da cena e libera o que só ele usa (rótulos HTML incluídos). */
export function dispose(o: THREE.Object3D): void {
  o.traverse((c) => {
    if (c instanceof CSS2DObject) c.element.remove()
    if (c instanceof THREE.Sprite) c.material.dispose()
  })
  o.removeFromParent()
}
