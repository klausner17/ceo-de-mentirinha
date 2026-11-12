// A planta da casa: o hall em cima e, descendo dele, um corredor central com os cômodos
// (um por projeto) dos dois lados. Cada cômodo tem uma porta para o corredor, e os
// liderados andam da porta da rua até a mesa passando pelo hall, pelo corredor e por ela.
// Embaixo das mesas, cada cômodo tem uma mesa da equipe onde os liderados sentam.
// Só faz contas: não depende do Three.js, para dar para testar.

export interface Point {
  x: number
  y: number
}

/** Medidas que vêm do mapa do hall e da arte, já em pixels da tela. */
export interface HouseFrame {
  /** Tamanho de um tile na tela. */
  tile: number
  /** Largura da casa (a do hall). */
  width: number
  hallHeight: number
  /** Faixa do corredor central. */
  corridor: { x: number; w: number }
  /** Onde os liderados aparecem, logo depois da porta da rua. */
  frontDoor: Point
}

export interface DeskSize {
  w: number
  h: number
  gap: number
  /** Espaço entre a parede e as mesas. */
  pad: number
  perRow: number
}

export interface RoomInput {
  key: string
  name: string
  desks: number
}

export interface Room {
  /** null para a sala livre que completa um par. */
  key: string | null
  name: string
  side: 'esquerda' | 'direita'
  x: number
  y: number
  w: number
  h: number
  /** Linha onde começa o chão (abaixo da parede de cima, que tem dois tiles). */
  floorY: number
  /** Coluna da parede do lado do corredor e as duas linhas da porta nela. */
  door: { x: number; y: number }
  desks: Point[]
  /** Centro da mesa da equipe, embaixo das mesas (null na sala livre). */
  team: Point | null
  /** Da porta da rua até logo depois da porta do cômodo. */
  route: Point[]
}

export interface HousePlan {
  rooms: Room[]
  corridor: { x: number; y: number; w: number; h: number }
  /** Topo da parede de baixo da casa. */
  bottom: number
  height: number
}

/** Altura da parede de cima de cada cômodo: topo e face. */
export const WALL_TILES = 2
/** Altura mínima do chão de um cômodo, em tiles. */
const MIN_FLOOR_TILES = 4

/**
 * A mesa da equipe, em pixels do plano: o tampo, quantas cadeiras de cada lado e a
 * distância entre elas. `h` é a faixa do cômodo que ela ocupa, com as cadeiras e a passagem.
 */
export const TEAM = { w: 176, d: 40, h: 112, perSide: 4, seatGap: 42 }

/** Um lugar na mesa da equipe: sentado numa cadeira ou de pé numa ponta, virado para `face`. */
export interface Spot extends Point {
  sit: boolean
  face: Point
}

/**
 * Os lugares em volta da mesa da equipe (centro `c`), na ordem em que são ocupados: primeiro
 * o lado de cima (de frente para a câmera), do meio para as pontas, depois o de baixo e, com
 * as cadeiras cheias, de pé nas duas pontas.
 */
export function teamSpots(c: Point): Spot[] {
  const xs = Array.from({ length: TEAM.perSide }, (_, i) => (i - (TEAM.perSide - 1) / 2) * TEAM.seatGap)
  xs.sort((a, b) => Math.abs(a) - Math.abs(b) || a - b)
  // Quem senta fica um pouco afastado da borda: as pernas vão para baixo do tampo.
  const off = TEAM.d / 2 + 10
  const spots: Spot[] = []
  for (const side of [-1, 1]) {
    for (const dx of xs) spots.push({ x: c.x + dx, y: c.y + side * off, sit: true, face: { x: c.x + dx, y: c.y } })
  }
  for (const side of [-1, 1]) {
    for (const dy of [-10, 10]) spots.push({ x: c.x + side * (TEAM.w / 2 + 18), y: c.y + dy, sit: false, face: { x: c.x, y: c.y + dy } })
  }
  return spots
}

/** O tampo da mesa da equipe com uma folguinha: é por onde ninguém passa. */
export function teamObstacle(c: Point): { x: number; y: number; w: number; h: number } {
  return { x: c.x - TEAM.w / 2 - 2, y: c.y - TEAM.d / 2 - 2, w: TEAM.w + 4, h: TEAM.d + 4 }
}

export function planHouse(frame: HouseFrame, inputs: RoomInput[], desk: DeskSize): HousePlan {
  const { tile, width, hallHeight, corridor } = frame
  const wall = WALL_TILES * tile
  const leftW = corridor.x
  const rightX = corridor.x + corridor.w
  const rightW = width - rightX
  const corridorX = corridor.x + corridor.w / 2

  const floorHeight = (n: number): number => {
    const rows = Math.max(1, Math.ceil(n / desk.perRow))
    // Mesas, a mesa da equipe embaixo delas e o espaço até as paredes.
    const inner = desk.pad * 2 + rows * desk.h + rows * desk.gap + TEAM.h
    return Math.max(MIN_FLOOR_TILES, Math.ceil(inner / tile)) * tile
  }

  const rooms: Room[] = []
  let y = hallHeight
  for (let i = 0; i < inputs.length; i += 2) {
    const left = inputs[i]!
    const right = inputs[i + 1]
    const h = wall + Math.max(floorHeight(left.desks), right ? floorHeight(right.desks) : 0)
    const pair: Array<[RoomInput | undefined, Room['side']]> = [
      [left, 'esquerda'],
      [right, 'direita']
    ]
    for (const [input, side] of pair) {
      const x = side === 'esquerda' ? 0 : rightX
      const w = side === 'esquerda' ? leftW : rightW
      const floorY = y + wall
      // A porta ocupa as duas primeiras linhas do chão, na parede do lado do corredor.
      const door = { x: side === 'esquerda' ? x + w - tile / 2 : x + tile / 2, y: floorY + tile }
      const inside = { x: door.x + (side === 'esquerda' ? -1.5 : 1.5) * tile, y: door.y + tile / 2 }
      const route = [
        frame.frontDoor,
        { x: corridorX, y: hallHeight - tile / 2 },
        { x: corridorX, y: door.y + tile / 2 },
        { x: door.x, y: door.y + tile / 2 },
        inside
      ]

      const desks: Point[] = []
      let team: Point | null = null
      if (input) {
        const innerX = x + tile
        const innerW = w - 2 * tile
        const blockW = desk.perRow * desk.w + (desk.perRow - 1) * desk.gap
        const x0 = innerX + Math.max(0, Math.floor((innerW - blockW) / 2))
        for (let d = 0; d < input.desks; d++) {
          desks.push({
            x: x0 + (d % desk.perRow) * (desk.w + desk.gap),
            y: floorY + desk.pad + Math.floor(d / desk.perRow) * (desk.h + desk.gap)
          })
        }
        const rows = Math.max(1, Math.ceil(input.desks / desk.perRow))
        team = { x: x + w / 2, y: floorY + desk.pad + rows * (desk.h + desk.gap) + TEAM.h / 2 }
      }
      rooms.push({ key: input?.key ?? null, name: input?.name ?? 'Sala livre', side, x, y, w, h, floorY, door, desks, team, route })
    }
    y += h
  }

  return {
    rooms,
    corridor: { x: corridor.x, y: hallHeight, w: corridor.w, h: y - hallHeight },
    bottom: y,
    height: y + tile
  }
}
