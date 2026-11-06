// Carrega a pixel art (gerada por scripts/gerar-arte.mjs) e registra as animações.
// Os números dos quadros seguem a ordem definida naquele script.

import Phaser from 'phaser'
import type { Seniority } from '@shared/types'
import mapa from '../../../assets/mapa/escritorio.json'
import desconhecidoUrl from '../../../assets/sprites/funcionario-desconhecido.png?url'
import diretorUrl from '../../../assets/sprites/funcionario-diretor.png?url'
import juniorUrl from '../../../assets/sprites/funcionario-junior.png?url'
import plenoUrl from '../../../assets/sprites/funcionario-pleno.png?url'
import itensUrl from '../../../assets/sprites/itens.png?url'
import mesaUrl from '../../../assets/sprites/mesa.png?url'
import monitorUrl from '../../../assets/sprites/monitor.png?url'
import tilesUrl from '../../../assets/sprites/tiles.png?url'

/** Cada pixel da arte vira SCALE×SCALE pixels na tela. */
export const SCALE = 2
export const TILE = 16 * SCALE

export const SENIORITIES: Seniority[] = ['diretor', 'pleno', 'junior', 'desconhecido']
const PEOPLE: Record<Seniority, string> = { diretor: diretorUrl, pleno: plenoUrl, junior: juniorUrl, desconhecido: desconhecidoUrl }

export type Pose = 'sentado' | 'digitando' | 'lendo' | 'procurando' | 'dormindo' | 'apontando' | 'andando'
const POSES: Record<Pose, { frames: number[]; rate: number }> = {
  sentado: { frames: [0], rate: 1 },
  digitando: { frames: [1, 2], rate: 6 },
  lendo: { frames: [3, 4], rate: 2 },
  procurando: { frames: [5], rate: 1 },
  dormindo: { frames: [6], rate: 1 },
  apontando: { frames: [7, 0], rate: 2 },
  andando: { frames: [8, 9], rate: 6 }
}

export type Screen = 'desligado' | 'codigo' | 'terminal' | 'navegador' | 'erro'
export const SCREEN: Record<Screen, number> = { desligado: 0, codigo: 1, terminal: 2, navegador: 3, erro: 4 }

export const ITEM = { papel: 0, amassado: 1, fumaca: 2, postit: 3, cafe: 4, suor: 5, z: 6, planta: 7, cadeira: 8 } as const

/** Índices do tileset (iguais aos do script; no Tiled o gid é índice + 1). */
export const TILES = {
  carpete: 0, carpeteB: 1, madeira: 2, paredeTopo: 3, parede: 4, porta: 5, janela: 6, tapete: 7,
  planta: 8, sofaE: 10, sofaD: 11, quadro: 14, piso: 15, paredeLado: 16, batente: 17
} as const

export const personKey = (s: Seniority) => `funcionario-${s}`
export const animKey = (s: Seniority, pose: Pose) => `${s}-${pose}`

export function preload(scene: Phaser.Scene): void {
  for (const s of SENIORITIES) scene.load.spritesheet(personKey(s), PEOPLE[s], { frameWidth: 16, frameHeight: 17 })
  scene.load.spritesheet('itens', itensUrl, { frameWidth: 16, frameHeight: 16 })
  scene.load.spritesheet('monitor', monitorUrl, { frameWidth: 16, frameHeight: 12 })
  scene.load.spritesheet('tiles-quadros', tilesUrl, { frameWidth: 16, frameHeight: 16 })
  scene.load.image('mesa', mesaUrl)
  scene.load.image('tiles', tilesUrl)
  scene.load.tilemapTiledJSON('escritorio', mapa)
}

export function createAnimations(scene: Phaser.Scene): void {
  for (const s of SENIORITIES) {
    for (const [pose, { frames, rate }] of Object.entries(POSES)) {
      scene.anims.create({
        key: animKey(s, pose as Pose),
        frames: scene.anims.generateFrameNumbers(personKey(s), { frames }),
        frameRate: rate,
        repeat: -1
      })
    }
  }
}
