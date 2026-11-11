// Carrega a pixel art (gerada por scripts/gerar-arte.mjs) que vira textura no 3D: os tiles
// do mapa (chão, paredes, estante...), as telas do monitor e os itens (Z, suor, envelope...).
// Os números dos quadros seguem a ordem definida naquele script.

import mapa from '../../../assets/mapa/escritorio.json'
import itensUrl from '../../../assets/sprites/itens.png?url'
import monitorUrl from '../../../assets/sprites/monitor.png?url'
import tilesUrl from '../../../assets/sprites/tiles.png?url'

/** O mapa do hall, também usado para montar a grade de caminhada. */
export { mapa }

/** Cada pixel da arte vira SCALE×SCALE pixels no plano da casa (as contas da planta usam isso). */
export const SCALE = 2
/** Um tile em pixels do plano. No 3D, um tile é uma unidade. */
export const TILE = 16 * SCALE

export type Pose = 'sentado' | 'digitando' | 'lendo' | 'procurando' | 'dormindo' | 'apontando' | 'andando'

export type Screen = 'desligado' | 'codigo' | 'terminal' | 'navegador' | 'erro' | 'email'
export const SCREEN: Record<Screen, number> = { desligado: 0, codigo: 1, terminal: 2, navegador: 3, erro: 4, email: 5 }

export const ITEM = { papel: 0, amassado: 1, fumaca: 2, postit: 3, cafe: 4, suor: 5, z: 6, planta: 7, cadeira: 8, envelope: 9, interrogacao: 10 } as const

/** Índices do tileset (iguais aos do script; no Tiled o gid é índice + 1). */
export const TILES = {
  carpete: 0, carpeteB: 1, madeira: 2, paredeTopo: 3, parede: 4, porta: 5, janela: 6, tapete: 7,
  planta: 8, cafeteira: 9, sofaE: 10, sofaD: 11, estante: 12, fichario: 13, quadro: 14, piso: 15, paredeLado: 16, batente: 17
} as const

/** Uma folha de quadros: a imagem e o tamanho de cada quadro. */
export interface Sheet {
  image: HTMLImageElement
  frameWidth: number
  frameHeight: number
}

export interface Art {
  tiles: Sheet
  monitor: Sheet
  itens: Sheet
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Não deu para carregar ${url}`))
    img.src = url
  })
}

export async function loadArt(): Promise<Art> {
  const [tiles, monitor, itens] = await Promise.all([loadImage(tilesUrl), loadImage(monitorUrl), loadImage(itensUrl)])
  return {
    tiles: { image: tiles, frameWidth: 16, frameHeight: 16 },
    monitor: { image: monitor, frameWidth: 16, frameHeight: 12 },
    itens: { image: itens, frameWidth: 16, frameHeight: 16 }
  }
}

/** Recorta o quadro `index` da folha num canvas do tamanho do quadro. */
export function frameCanvas(sheet: Sheet, index: number): HTMLCanvasElement {
  const { image, frameWidth: w, frameHeight: h } = sheet
  const cols = Math.max(1, Math.floor(image.width / w))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.drawImage(image, (index % cols) * w, Math.floor(index / cols) * h, w, h, 0, 0, w, h)
  return canvas
}
