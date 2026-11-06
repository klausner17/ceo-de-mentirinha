#!/usr/bin/env node
// Fase 6: gera a pixel art do escritório e o mapa no formato do Tiled.
//
// Toda a arte é original, desenhada aqui como texto (um caractere por pixel),
// e fica sob a mesma licença do projeto (MIT). Rodar de novo sobrescreve
// assets/sprites/*.png e assets/mapa/escritorio.json.
//
// Uso: npm run arte

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const spritesDir = join(root, 'assets', 'sprites')
const mapDir = join(root, 'assets', 'mapa')
mkdirSync(spritesDir, { recursive: true })
mkdirSync(mapDir, { recursive: true })

// ---------------------------------------------------------------- PNG

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bits
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ---------------------------------------------------------------- Folhas

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255]

/** Monta uma folha com quadros de w×h a partir de desenhos em texto. */
function sheet(name, w, h, frames, palette, columns = frames.length) {
  const rows = Math.ceil(frames.length / columns)
  const W = w * columns
  const H = h * rows
  const buf = Buffer.alloc(W * H * 4)
  frames.forEach((art, i) => {
    const lines = art.trim().split('\n').map((l) => l.trim())
    if (lines.length !== h) throw new Error(`${name}[${i}]: ${lines.length} linhas, esperava ${h}`)
    const ox = (i % columns) * w
    const oy = Math.floor(i / columns) * h
    lines.forEach((line, y) => {
      if (line.length !== w) throw new Error(`${name}[${i}] linha ${y}: ${line.length} colunas, esperava ${w}`)
      ;[...line].forEach((ch, x) => {
        if (ch === '.') return
        const color = palette[ch]
        if (!color) throw new Error(`${name}[${i}]: cor '${ch}' não está na paleta`)
        buf.set(hex(color), ((oy + y) * W + ox + x) * 4)
      })
    })
  })
  writeFileSync(join(spritesDir, `${name}.png`), png(W, H, buf))
  return { name, frameWidth: w, frameHeight: h, frames: frames.length }
}

// ---------------------------------------------------------------- Funcionários

// Cabeças (linhas 0 a 8) e corpos (linhas 9 a 15). k = contorno, s = pele,
// h = cabelo, c = roupa, C = sombra da roupa, t = gravata/detalhe, e = olho.
const HEAD = `
....kkkkkkkk....
...khhhhhhhhk...
..khhhhhhhhhhk..
..khsssssssshk..
..kssessssessk..
..kssssssssssk..
...kssskksssk...
....kssssssk....
.....kkkkkk.....`

const HEAD_SLEEP = `
................
....kkkkkkkk....
...khhhhhhhhk...
..khhhhhhhhhhk..
..khsssssssshk..
..kssksssskssk..
..ksssssssssskk.
...kssssssssk...
....kkkkkkkk....`

const BODY = {
  sentado: `
...kkkkkkkkkk...
..kcccccttccccck
..kccccctcccccck
..kscccctcccccsk
..ksccccccccccsk
..kscCCCCCCCCcsk
..kkkcccccccckkk
....kkkkkkkkk...`,
  digitandoA: `
...kkkkkkkkkk...
..kcccccttccccck
..kccccctcccccck
..kccccctccccsk.
..kcccccccccsk..
..kCCCCCCCCss...
.kssccccccckk...
.kkkkkkkkkk.....`,
  digitandoB: `
...kkkkkkkkkk...
..kcccccttccccck
..kccccctcccccck
.kscccctcccccck.
..kscccccccccck.
...ssCCCCCCCCck.
...kkcccccccssk.
.....kkkkkkkkkk.`,
  lendoA: `
...kkkkkkkkkk...
..kcccccttccccck
..kccffffffcccck
..ksfwwwwwwfccsk
..ksfwkkkkwfccsk
..kscfffffffccsk
..kkkcccccccckkk
....kkkkkkkkk...`,
  lendoB: `
...kkkkkkkkkk...
..kcccccttccccck
..kcccffffffccck
..kscfwwwwwwfcsk
..kscfwkkkkwfcsk
..ksccfffffffcsk
..kkkcccccccckkk
....kkkkkkkkk...`,
  procurando: `
...kkkkkkkkkk...
..kcccccttcccckk
..kccccctccccsgk
..kscccctccccgwk
..ksccccccccskgk
..kscCCCCCCCsk..
..kkkccccccckk..
....kkkkkkkkk...`,
  apontando: `
...kkkkkkkkkk.ks
..kcccccttcccskk
..kccccctccccsk.
..kscccctcccsk..
..kscccccccck...
..kscCCCCCCCk...
..kkkcccccccckk.
....kkkkkkkkk...`,
  andandoA: `
...kkkkkkkkkk...
..kscccttcccsk..
..kscccctcccsk..
..kssccccccssk..
...kppppppppk...
...kpppkkpppk...
...kppk..kppk...
...kkk....kkk...`,
  andandoB: `
...kkkkkkkkkk...
..kscccttcccsk..
..kscccctcccsk..
..kssccccccssk..
...kppppppppk...
...kpppkkpppk...
....kpk..kppk...
....kk...kkkk...`
}

// Ordem dos quadros: o renderer depende dela (src/renderer/src/art.ts).
const PERSON_FRAMES = [
  HEAD + BODY.sentado, //  0 sentado
  HEAD + BODY.digitandoA, //  1 digitando
  HEAD + BODY.digitandoB, //  2 digitando
  HEAD + BODY.lendoA, //  3 lendo
  HEAD + BODY.lendoB, //  4 lendo
  HEAD + BODY.procurando, //  5 procurando
  HEAD_SLEEP + BODY.sentado, //  6 dormindo
  HEAD + BODY.apontando, //  7 delegando
  HEAD + BODY.andandoA, //  8 andando
  HEAD + BODY.andandoB //  9 andando
]

const BASE = { k: '#1d1f27', s: '#f1c27d', e: '#1d1f27', w: '#f4f1ea', f: '#c58b4a', g: '#9fd3ff', p: '#3b3f4f' }
const SENIORITY = {
  diretor: { h: '#4a3426', c: '#5b3f8c', C: '#45306b', t: '#e8c35b' },
  pleno: { h: '#2b2b2b', c: '#3f6fb5', C: '#30568d', t: '#f4f1ea' },
  junior: { h: '#c9873e', c: '#4fb3a9', C: '#3b8f86', t: '#f4f1ea' },
  desconhecido: { h: '#6b6b6b', c: '#7d8590', C: '#5f6672', t: '#cfd3da' },
  // Office boy dos conectores MCP: boné vermelho e uniforme amarelo.
  officeboy: { h: '#c0392b', c: '#e8b923', C: '#b8901a', t: '#c0392b' }
}
for (const [name, colors] of Object.entries(SENIORITY)) {
  sheet(name === 'officeboy' ? 'officeboy' : `funcionario-${name}`, 16, 17, PERSON_FRAMES.map((f) => f.trim()), { ...BASE, ...colors })
}

// ---------------------------------------------------------------- Mesa e monitor

const DESK = Array.from({ length: 20 }, (_, y) => {
  const row = (edge, inner) => `${edge}${inner.repeat(46)}${edge}`
  if (y === 0 || y === 9 || y === 17) return 'k'.repeat(48)
  if (y === 1 || y === 8) return row('k', 'M')
  if (y < 8) return `kM${'m'.repeat(44)}Mk`
  if (y === 10 || y === 16) return row('k', 'D')
  if (y === 12) return `kDdddd${'k'.repeat(7)}${'d'.repeat(22)}${'k'.repeat(7)}ddddDk`
  if (y < 17) return `kD${'d'.repeat(44)}Dk`
  if (y === 18) return `.kDk${'.'.repeat(40)}kDk.` // pés
  return `.kkk${'.'.repeat(40)}kkk.`
})
sheet('mesa', 48, 20, [DESK.join('\n')], { k: '#2a1c12', M: '#a8754a', m: '#b98556', D: '#7a5232', d: '#8b5e3c' })

// Quadros do monitor: desligado, código, terminal, navegador, erro.
const MONITOR = (screen) => `
kkkkkkkkkkkkkkkk
k${screen[0]}k
k${screen[1]}k
k${screen[2]}k
k${screen[3]}k
k${screen[4]}k
k${screen[5]}k
k${screen[6]}k
kkkkkkkkkkkkkkkk
......kkkk......
.....kkkkkk.....
....kkkkkkkk....`
sheet('monitor', 16, 12, [
  MONITOR(['oooooooooooooo', 'oooooooooooooo', 'oooooooooooooo', 'oooooooooooooo', 'oooooooooooooo', 'oooooooooooooo', 'oooooooooooooo']),
  MONITOR(['bbbbbbbbbbbbbb', 'byyyybbbbbbbbb', 'bbbggggggbbbbb', 'bbbgggbwwwwbbb', 'bbbbbbbbbbbbbb', 'byyybgggggbbbb', 'bbbbbbbbbbbbbb']),
  MONITOR(['oooooooooooooo', 'oGoGGGGooooooo', 'oooooooooooooo', 'oGoGGGGGGGoooo', 'oooooooooooooo', 'oGoWoooooooooo', 'oooooooooooooo']),
  MONITOR(['LLLLLLLLLLLLLL', 'Lwwwwwwwwwwwwl', 'lwbbbbwwwwwwwl', 'lwwwwwwwwwwwwl', 'lwbbbbbbbbbwwl', 'lwwwwwwwwwwwwl', 'llllllllllllll']),
  MONITOR(['rrrrrrrrrrrrrr', 'rrrrrrwwrrrrrr', 'rrrrrrwwrrrrrr', 'rrrrrrwwrrrrrr', 'rrrrrrrrrrrrrr', 'rrrrrrwwrrrrrr', 'rrrrrrrrrrrrrr'])
].map((m) => m.trim()), {
  k: '#14151a', o: '#0b0c10', b: '#1e2a3a', y: '#c792ea', g: '#c3e88d', w: '#e8e6e3', G: '#7ee787', W: '#e8e6e3',
  L: '#5a8fd8', l: '#cfd8e8', r: '#b3261e'
})

// ---------------------------------------------------------------- Itens

sheet('itens', 16, 16, [
  // 0 folha de papel
  `
................
................
................
................
................
................
.kkkkkkkkkkkkkk.
.kwwwwwwwwwwwwk.
.kwqqqqqqqqqwwk.
.kkkkkkkkkkkkkk.
................
................
................
................
................
................`,
  // 1 papel amassado
  `
................
................
................
................
.....kkkk.......
....kwwqwkk.....
...kwqwwwqwk....
...kwwkwqwwk....
...kqwwwkwqk....
....kwqwwwk.....
.....kkkkk......
................
................
................
................
................`,
  // 2 fumaça
  `
................
................
.......nnn......
.....nnNNNnn....
....nNNNNNNNn...
...nNNNnnNNNNn..
...nNNnnnnNNNn..
..nNNNNnnNNNNNn.
..nNNNNNNNNNNNn.
...nNNNNNNNNNn..
....nnNNNNNnn...
......nnnnn.....
................
................
................
................`,
  // 3 post-it
  `
................
................
................
................
....kkkkkkkk....
....kyyyyyyk....
....kyqqqqyk....
....kyyyyyyk....
....kyqqqyyk....
....kyyyyyyk....
....kkkkkkkk....
................
................
................
................
................`,
  // 4 xícara de café
  `
................
................
................
.......n........
......n.n.......
.......n........
....kkkkkkk.....
....kwwwwwkkk...
....kwcccwk.k...
....kwwwwwkkk...
....kwwwwwk.....
.....kkkkk......
................
................
................
................`,
  // 5 gota de suor
  `
................
................
................
.......k........
......kgk.......
.....kgggk......
.....kggwk......
.....kgggk......
......kkk.......
................
................
................
................
................
................
................`,
  // 6 Z
  `
................
................
................
................
....kkkkkkk.....
....kwwwwwk.....
.......kwk......
......kwk.......
.....kwk........
....kwwwwwk.....
....kkkkkkk.....
................
................
................
................
................`,
  // 7 vaso de planta
  `
.......vv.......
.....vvVVvv.....
....vVVvvVVv....
...vVvvVVvvVv...
...vVVvVVvVVv...
....vvVVVVvv....
.....vvVvvv.....
......kkkk......
.....kTTTTk.....
.....kTttTk.....
.....kTttTk.....
.....kTttTk.....
......kkkk......
................
................
................`,
  // 8 cadeira
  `
................
....kkkkkkkk....
...kaaaaaaaak...
...kaAAAAAAak...
...kaAAAAAAak...
...kaAAAAAAak...
...kaaaaaaaak...
....kkkkkkkk....
................
................
................
................
................
................
................
................`,
  // 9 envelope
  `
................
................
................
................
...kkkkkkkkkk...
...kwwwwwwwwk...
...kkwwwwwwkk...
...kwkwwwwkwk...
...kwwkrrkwwk...
...kwwwwwwwwk...
...kkkkkkkkkk...
................
................
................
................
................`,
  // 10 interrogação
  `
................
.....kkkkk......
....kwwwwwk.....
....kwkkkwk.....
.....k..kwk.....
.......kwk......
......kwk.......
......kwk.......
......kkk.......
......kwk.......
......kkk.......
................
................
................
................
................`
].map((s) => s.trim()), {
  r: '#c0392b', k: '#1d1f27', w: '#f4f1ea', q: '#a6accd', n: '#8b8f9c', N: '#b8bcc8', y: '#ffe066', c: '#6b4226', g: '#9fd3ff',
  v: '#2f7d32', V: '#4caf50', T: '#b5651d', t: '#8b4513', a: '#2c2f3a', A: '#3a3f4d'
})

// ---------------------------------------------------------------- Portaria

// Balcão da portaria com o malote (sprite próprio, fora do tileset do mapa).
sheet('portaria', 32, 20, [`
kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
kDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDk
kDwkykkwkkrkwkDDkykkwkkgkkwkrkDk
kDkkkkkkkkkkkkDDkkkkkkkkkkkkkkDk
kDkwkkgkkwkkykDDkwkkrkkykkwkgkDk
kDkkkkkkkkkkkkDDkkkkkkkkkkkkkkDk
kDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDk
kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
kMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMk
kmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmk
kmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmk
kmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmk
kMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMk
kDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDk
kDddddddddddddddddddddddddddddDk
kDddddddddddddddddddddddddddddDk
kDddddddddddddddddddddddddddddDk
kDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDk
kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
................................`.trim()], {
  k: '#1d1f27', D: '#5c3d26', d: '#8b5e3c', M: '#7a5232', m: '#b98556', w: '#f4f1ea', y: '#e8c35b', r: '#ff7b72', g: '#7ee787'
})

// ---------------------------------------------------------------- Tileset do mapa

// Índices (começando em 0; no Tiled o gid é índice + 1):
const T = {
  carpete: 0, carpeteB: 1, madeira: 2, paredeTopo: 3, parede: 4, porta: 5, janela: 6, tapete: 7,
  planta: 8, cafeteira: 9, sofaE: 10, sofaD: 11, estante: 12, fichario: 13, quadro: 14, piso: 15
}
const tiles = []
const fill = (ch) => Array.from({ length: 16 }, () => ch.repeat(16)).join('\n')
const pattern = (a, b, every = 4) =>
  Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => ((x + y) % every === 0 ? b : a)).join('')).join('\n')
tiles[T.carpete] = pattern('c', 'C', 5)
tiles[T.carpeteB] = pattern('c', 'C', 7)
tiles[T.madeira] = Array.from({ length: 16 }, (_, y) => (y % 4 === 3 ? 'M'.repeat(16) : `${'m'.repeat(7 + (y % 8 < 4 ? 0 : 4))}M${'m'.repeat(8 - (y % 8 < 4 ? 0 : 4))}`)).join('\n')
tiles[T.paredeTopo] = Array.from({ length: 16 }, (_, y) => (y < 12 ? 'P'.repeat(16) : 'k'.repeat(16))).join('\n')
tiles[T.parede] = Array.from({ length: 16 }, (_, y) => (y < 2 ? 'k'.repeat(16) : y > 13 ? 'R'.repeat(16) : 'p'.repeat(16))).join('\n')
tiles[T.porta] = `
kkkkkkkkkkkkkkkk
kDDDDDDDDDDDDDDk
kDddddddddddddDk
kDdkkkkddkkkkdDk
kDdkddkddkddkdDk
kDdkkkkddkkkkdDk
kDddddddddddddDk
kDdddddddddyydDk
kDdddddddddyydDk
kDddddddddddddDk
kDdkkkkddkkkkdDk
kDdkddkddkddkdDk
kDdkkkkddkkkkdDk
kDddddddddddddDk
kDDDDDDDDDDDDDDk
kkkkkkkkkkkkkkkk`
tiles[T.janela] = `
kkkkkkkkkkkkkkkk
pppppppppppppppp
ppkkkkkkkkkkkkpp
ppkBBBBkkBBBBkpp
ppkBbbBkkBbbBkpp
ppkBBBBkkBBBBkpp
ppkBBbBkkBBbBkpp
ppkkkkkkkkkkkkpp
ppkBBBBkkBBBBkpp
ppkBbBBkkBbBBkpp
ppkBBBBkkBBBBkpp
ppkkkkkkkkkkkkpp
pppppppppppppppp
pppppppppppppppp
RRRRRRRRRRRRRRRR
RRRRRRRRRRRRRRRR`
tiles[T.tapete] = `
kkkkkkkkkkkkkkkk
kTTTTTTTTTTTTTTk
kTttttttttttttTk
kTtyyyyyyyyyytTk
kTtyttttttttytTk
kTtytyyyyyytytTk
kTtytyttttytytTk
kTtytytyytytytTk
kTtytytyytytytTk
kTtytyttttytytTk
kTtytyyyyyytytTk
kTtyttttttttytTk
kTtyyyyyyyyyytTk
kTttttttttttttTk
kTTTTTTTTTTTTTTk
kkkkkkkkkkkkkkkk`
tiles[T.planta] = `
cccccccvvccccccc
cccccvvVVvvccccc
ccccvVVvvVVvcccc
cccvVvvVVvvVvccc
cccvVVvVVvVVvccc
ccccvvVVVVvvcccc
cccccvvVvvvccccc
cccccckkkkcccccc
ccccckTTTTkccccc
ccccckTttTkccccc
ccccckTttTkccccc
ccccckTttTkccccc
cccccckkkkcccccc
cCcccccccccccccc
cccccCcccccccccC
cccccccccCcccccc`
tiles[T.cafeteira] = `
cccckkkkkkkkcccc
ccckSSSSSSSSkccc
ccckSssssssSkccc
ccckSsrrssgSkccc
ccckSssssssSkccc
ccckSSSSSSSSkccc
ccckSkkkkkkSkccc
ccckSkcccckSkccc
ccckSkwwwwkSkccc
ccckSkwnnwkSkccc
ccckSkwwwwkSkccc
ccckSSSSSSSSkccc
ccckkkkkkkkkkccc
cccccccccccccccc
ccCcccccccccCccc
cccccccccccccccc`
tiles[T.sofaE] = `
cccccccccccccccc
ckkkkkkkkkkkkkkk
kaaaaaaaaaaaaaaa
kaAAAAAAAAAAAAAA
kaAAAAAAAAAAAAAA
kaAAAAAAAAAAAAAA
kaaaaaaaaaaaaaaa
kaAAAAAAAAAAAAAA
kaAAAAAAAAAAAAAA
kaAAAAAAAAAAAAAA
kaaaaaaaaaaaaaaa
kkkkkkkkkkkkkkkk
ckkccccccccccccc
cccccccccccccccc
ccccccCccccccccc
cccccccccccccccc`
tiles[T.sofaD] = tiles[T.sofaE].split('\n').map((l) => [...l].reverse().join('')).join('\n')
tiles[T.estante] = `
kkkkkkkkkkkkkkkk
kDDDDDDDDDDDDDDk
kDrrbbyyggrrbbDk
kDrrbbyyggrrbbDk
kDrrbbyyggrrbbDk
kDDDDDDDDDDDDDDk
kDggrryybbggyyDk
kDggrryybbggyyDk
kDggrryybbggyyDk
kDDDDDDDDDDDDDDk
kDbbyyrrggbbrrDk
kDbbyyrrggbbrrDk
kDbbyyrrggbbrrDk
kDDDDDDDDDDDDDDk
kkkkkkkkkkkkkkkk
cccccccccccccccc`
tiles[T.fichario] = `
cckkkkkkkkkkkkcc
ckSSSSSSSSSSSSkc
ckSssssssssssSkc
ckSssskkkksssSkc
ckSssssssssssSkc
ckSSSSSSSSSSSSkc
ckSssssssssssSkc
ckSssskkkksssSkc
ckSssssssssssSkc
ckSSSSSSSSSSSSkc
ckSssssssssssSkc
ckSssskkkksssSkc
ckSssssssssssSkc
ckSSSSSSSSSSSSkc
cckkkkkkkkkkkkcc
cccccccccccccccc`
tiles[T.quadro] = `
kkkkkkkkkkkkkkkk
pppppppppppppppp
pkkkkkkkkkkkkkkp
pkwwwwwwwwwwwwkp
pkwbbbwwwrrwwwkp
pkwwwwwwrwwrwwkp
pkwbbbbwwrrwwwkp
pkwwwwwwwwwwwwkp
pkwgggwwbbbbwwkp
pkwwwwwwwwwwwwkp
pkkkkkkkkkkkkkkp
pppppkkkkkkppppp
pppppppppppppppp
pppppppppppppppp
RRRRRRRRRRRRRRRR
RRRRRRRRRRRRRRRR`
tiles[T.piso] = Array.from({ length: 16 }, (_, y) => (y === 15 ? 'F'.repeat(16) : `F${'f'.repeat(15)}`)).join('\n')

const tilesetCols = 8
sheet('tiles', 16, 16, tiles.map((t) => t.trim()), {
  k: '#1d1f27', c: '#3c4a63', C: '#4a5a78', m: '#9c6b3f', M: '#7a5232', P: '#4b5163', p: '#6c7489', R: '#3a3f4d',
  D: '#5c3d26', d: '#8b5e3c', y: '#e8c35b', B: '#7cc4ff', b: '#d6efff', T: '#7a2e2e', t: '#a33f3f', v: '#2f7d32',
  V: '#4caf50', S: '#9aa1b2', s: '#cfd3da', r: '#ff7b72', g: '#7ee787', w: '#f4f1ea', n: '#6b4226', a: '#7a3e9d',
  A: '#9454bd', F: '#c9c2b2', f: '#ddd6c6'
}, tilesetCols)

// ---------------------------------------------------------------- Mapa do Tiled

// O hall de entrada: parede com janelas, porta por onde os liderados entram,
// estante de skills, fichário de memória, cantinho do café e sala do CEO.
const W = 40
const H = 6
const gid = (i) => (i === null ? 0 : i + 1)
const ground = []
const furniture = []
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let g = null
    let f = null
    if (y === 0) g = T.paredeTopo
    else if (y === 1) g = x === 4 ? T.porta : x % 6 === 2 && x < 30 ? T.janela : x === 20 ? T.quadro : x === 37 ? T.janela : T.parede
    else g = x >= 30 ? (x === 30 ? T.paredeTopo : T.madeira) : y === H - 1 ? T.piso : (x + y) % 2 ? T.carpete : T.carpeteB
    if (y === 2 && x === 9) f = T.estante
    if (y === 2 && x === 10) f = T.fichario
    if (y === 2 && (x === 14 || x === 26)) f = T.planta
    if (y === 2 && x === 16) f = T.cafeteira
    if (y === 3 && x === 17) f = T.sofaE
    if (y === 3 && x === 18) f = T.sofaD
    if (y === 4 && x === 35) f = T.tapete
    if (x === 30 && y > 1) g = T.parede
    ground.push(gid(g))
    furniture.push(gid(f))
  }
}

const map = {
  type: 'map',
  version: '1.10',
  tiledversion: '1.10.2',
  orientation: 'orthogonal',
  renderorder: 'right-down',
  width: W,
  height: H,
  tilewidth: 16,
  tileheight: 16,
  infinite: false,
  nextlayerid: 4,
  nextobjectid: 6,
  layers: [
    { id: 1, name: 'chao', type: 'tilelayer', x: 0, y: 0, width: W, height: H, opacity: 1, visible: true, data: ground },
    { id: 2, name: 'moveis', type: 'tilelayer', x: 0, y: 0, width: W, height: H, opacity: 1, visible: true, data: furniture },
    {
      id: 3,
      name: 'pontos',
      type: 'objectgroup',
      draworder: 'topdown',
      opacity: 1,
      visible: true,
      x: 0,
      y: 0,
      objects: [
        { id: 5, name: 'portaria', type: 'ponto', point: true, x: 7 * 16 + 8, y: 3 * 16 + 8, width: 0, height: 0, rotation: 0, visible: true },
        { id: 1, name: 'porta', type: 'ponto', point: true, x: 4 * 16 + 8, y: 2 * 16 + 8, width: 0, height: 0, rotation: 0, visible: true },
        { id: 2, name: 'cafe', type: 'ponto', point: true, x: 16 * 16 + 8, y: 3 * 16 + 8, width: 0, height: 0, rotation: 0, visible: true },
        { id: 3, name: 'sala-do-ceo', type: 'ponto', point: true, x: 35 * 16 + 8, y: 3 * 16 + 8, width: 0, height: 0, rotation: 0, visible: true },
        { id: 4, name: 'placa-sala-do-ceo', type: 'texto', point: true, x: 31 * 16 + 4, y: 1 * 16 + 4, width: 0, height: 0, rotation: 0, visible: true }
      ]
    }
  ],
  tilesets: [
    {
      firstgid: 1,
      name: 'tiles',
      image: '../sprites/tiles.png',
      imagewidth: tilesetCols * 16,
      imageheight: Math.ceil(tiles.length / tilesetCols) * 16,
      tilewidth: 16,
      tileheight: 16,
      tilecount: tiles.length,
      columns: tilesetCols,
      margin: 0,
      spacing: 0
    }
  ]
}
writeFileSync(join(mapDir, 'escritorio.json'), JSON.stringify(map, null, 1) + '\n')

console.log('Arte gerada em assets/sprites e assets/mapa')
