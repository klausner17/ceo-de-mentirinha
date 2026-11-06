// Uma mesa: funcionário, monitor, pilha de papel, balão da ferramenta e os liderados.

import Phaser from 'phaser'
import type { SessionState, SubagentState } from '@shared/types'
import { seniorityFor } from '@shared/seniority'
import { animKey, ITEM, personKey, SCALE, SCREEN, type Pose, type Screen } from '../art'
import { describeTool } from '../tools'

export const DESK_W = 224
export const DESK_H = 176
export const FONT = '-apple-system, "Segoe UI", system-ui, sans-serif'

const SHEET_TOKENS = 20_000
const MAX_SHEETS = 10
/** Contexto acima desta fração do limite: funcionário cansado (suor e café). */
const TIRED = 0.8
/** Um erro mais antigo que isto não dispara o papel amassado (ex.: ao abrir o app). */
const ERROR_FRESH_MS = 30_000
/** Velocidade dos liderados andando, em pixels por segundo. */
const WALK_SPEED = 220

/** Escreve o texto e corta com reticências até caber na largura. */
function fit(text: Phaser.GameObjects.Text, value: string, maxWidth: number): void {
  text.setText(value)
  let cut = value
  while (text.width > maxWidth && cut.length > 1) {
    cut = cut.slice(0, -1)
    text.setText(`${cut.trimEnd()}…`)
  }
}

function shortModel(model: string | null): string {
  if (!model) return 'modelo ?'
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

interface Subordinate {
  sprite: Phaser.GameObjects.Sprite
  label: Phaser.GameObjects.Text
  seniority: ReturnType<typeof seniorityFor>
  arrived: boolean
  slot: number
}

export class Desk {
  private readonly root: Phaser.GameObjects.Container
  private readonly person: Phaser.GameObjects.Sprite
  private readonly monitor: Phaser.GameObjects.Sprite
  private readonly balloon: Phaser.GameObjects.Text
  private readonly title: Phaser.GameObjects.Text
  private readonly subtitle: Phaser.GameObjects.Text
  private readonly zzz: Phaser.GameObjects.Sprite
  private readonly sweat: Phaser.GameObjects.Sprite
  private readonly coffee: Phaser.GameObjects.Sprite
  private readonly papers: Phaser.GameObjects.Container
  private readonly postits: Phaser.GameObjects.Container
  private readonly team = new Map<string, Subordinate>()

  private seniority: ReturnType<typeof seniorityFor> = 'desconhecido'
  private pose: Pose | null = null
  private sheets = 0
  private lastErrorAt: number | null = null
  private errorUntil = 0
  private screen: Screen = 'desligado'

  constructor(
    private readonly scene: Phaser.Scene,
    x: number,
    y: number,
    private readonly door: { x: number; y: number }
  ) {
    const s = <T extends Phaser.GameObjects.Sprite | Phaser.GameObjects.Image>(o: T): T => o.setScale(SCALE) as T
    const cx = DESK_W / 2

    const chair = s(scene.add.sprite(cx, 82, 'itens', ITEM.cadeira).setOrigin(0.5, 1))
    this.person = s(scene.add.sprite(cx, 86, personKey('desconhecido'), 0).setOrigin(0.5, 1))
    const desk = s(scene.add.image(cx, 78, 'mesa').setOrigin(0.5, 0))
    this.monitor = s(scene.add.sprite(cx - 34, 86, 'monitor', SCREEN.desligado).setOrigin(0.5, 1))
    this.papers = scene.add.container(cx + 34, 88)
    this.postits = scene.add.container(cx, 96).setVisible(false)
    for (let i = 0; i < 3; i++) this.postits.add(s(scene.add.sprite(-22 + i * 22, 0, 'itens', ITEM.postit)).setAngle(-8 + i * 8))
    this.coffee = s(scene.add.sprite(cx + 64, 92, 'itens', ITEM.cafe).setOrigin(0.5, 1)).setVisible(false)
    this.zzz = s(scene.add.sprite(cx + 22, 44, 'itens', ITEM.z)).setVisible(false)
    this.sweat = s(scene.add.sprite(cx + 18, 58, 'itens', ITEM.suor)).setVisible(false)

    this.balloon = scene.add
      .text(cx, 14, '', { fontFamily: FONT, fontSize: '12px', color: '#1d1f27', backgroundColor: '#f2c66d', padding: { x: 6, y: 3 } })
      .setOrigin(0.5)
      .setVisible(false)
    const plate = scene.add.rectangle(6, 124, DESK_W - 12, 44, 0x1d1f27, 0.72).setOrigin(0)
    this.title = scene.add.text(14, 128, '', { fontFamily: FONT, fontSize: '13px', fontStyle: 'bold', color: '#e8e6e3' })
    this.subtitle = scene.add.text(14, 147, '', { fontFamily: FONT, fontSize: '11px', color: '#9aa1b2' })

    this.root = scene.add.container(x, y, [
      chair, this.person, desk, this.monitor, this.papers, this.postits, this.coffee, this.zzz, this.sweat, plate, this.title, this.subtitle, this.balloon
    ])
    this.root.setDepth(10).setAlpha(0)
    scene.tweens.add({ targets: this.root, alpha: 1, duration: 400 })

    scene.tweens.add({ targets: this.zzz, y: 34, alpha: 0.2, duration: 1400, yoyo: true, repeat: -1 })
    scene.tweens.add({ targets: this.sweat, y: 64, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeIn' })
    scene.tweens.add({ targets: this.postits, y: 92, duration: 500, yoyo: true, repeat: -1 })
  }

  moveTo(x: number, y: number): void {
    if (this.root.x === x && this.root.y === y) return
    this.scene.tweens.add({ targets: this.root, x, y, duration: 250, ease: 'Sine.easeOut' })
    // Os liderados acompanham a mesa.
    for (const sub of this.team.values()) if (sub.arrived) this.walk(sub, this.slot(sub.slot, x, y))
  }

  update(s: SessionState): void {
    if (s.seniority !== this.seniority) {
      this.seniority = s.seniority
      this.pose = null
    }
    const idle = s.status === 'ocioso'
    const look = s.currentTool ? describeTool(s.currentTool.name) : null

    // Fase 4: pose e monitor seguem a ferramenta em uso.
    this.setPose(idle ? 'dormindo' : (look?.pose ?? 'sentado'))
    this.screen = idle ? 'desligado' : (look?.screen ?? 'codigo')
    if (Date.now() >= this.errorUntil) this.monitor.setFrame(SCREEN[this.screen])

    if (look) this.balloon.setText(look.label).setBackgroundColor(look.color).setVisible(true)
    else this.balloon.setVisible(false)
    this.postits.setVisible(look?.postits === true)

    this.zzz.setVisible(idle)
    const tired = s.contextTokens >= s.contextLimit * TIRED
    this.sweat.setVisible(tired && !idle)
    this.coffee.setVisible(tired)

    fit(this.title, s.title ?? s.id.slice(0, 8), DESK_W - 28)
    fit(this.subtitle, `${s.branch ?? 'sem branch'} · ${shortModel(s.model)} · ${Math.round(s.contextTokens / 1000)}k`, DESK_W - 28)

    this.updatePapers(s.contextTokens, s.contextLimit)
    this.maybeCrumple(s.lastErrorAt)
    this.updateTeam(s.subagents)
  }

  private setPose(pose: Pose): void {
    if (pose === this.pose) return
    this.pose = pose
    this.person.setTexture(personKey(this.seniority))
    this.person.play(animKey(this.seniority, pose))
  }

  /** Pilha de papel: uma folha a cada 20 mil tokens; folhas novas caem na pilha. */
  private updatePapers(tokens: number, limit: number): void {
    const target = Math.min(MAX_SHEETS, Math.ceil(tokens / SHEET_TOKENS))
    const full = tokens >= limit * TIRED
    while (this.sheets < target) {
      const i = this.sheets++
      const sheet = this.scene.add
        .sprite((i % 2) * 2, -i * 3 * SCALE, 'itens', ITEM.papel)
        .setScale(SCALE)
        .setOrigin(0.5, 0.6)
      this.papers.add(sheet)
      this.scene.tweens.add({ targets: sheet, y: { from: sheet.y - 40, to: sheet.y }, alpha: { from: 0, to: 1 }, duration: 300, ease: 'Bounce.easeOut' })
    }
    while (this.sheets > target) {
      // Compactação: a pilha diminui.
      this.sheets--
      this.papers.getAt(this.papers.length - 1)?.destroy()
    }
    for (const sheet of this.papers.list as Phaser.GameObjects.Sprite[]) {
      if (full) sheet.setTint(0xffc9c9)
      else sheet.clearTint()
    }
  }

  /** Erro numa ferramenta: monitor vermelho, papel amassado voando e fumaça. */
  private maybeCrumple(lastErrorAt: number | null): void {
    if (lastErrorAt === null || lastErrorAt === this.lastErrorAt) return
    const first = this.lastErrorAt === null
    this.lastErrorAt = lastErrorAt
    if (first && Date.now() - lastErrorAt > ERROR_FRESH_MS) return

    this.errorUntil = Date.now() + 2500
    this.monitor.setFrame(SCREEN.erro)
    this.scene.time.delayedCall(2500, () => this.monitor.setFrame(SCREEN[this.screen]))

    const { x, y } = this.root
    const paper = this.scene.add.sprite(x + DESK_W / 2, y + 60, 'itens', ITEM.amassado).setScale(SCALE).setDepth(15)
    const landX = x + DESK_W - 24 - Math.random() * 30
    this.scene.tweens.add({ targets: paper, x: landX, duration: 600, ease: 'Linear' })
    this.scene.tweens.add({
      targets: paper,
      y: { from: y + 60, to: y + 30 },
      duration: 300,
      yoyo: false,
      ease: 'Sine.easeOut',
      onComplete: () => this.scene.tweens.add({ targets: paper, y: y + 112, angle: 180, duration: 300, ease: 'Bounce.easeOut' })
    })
    this.scene.tweens.add({ targets: paper, alpha: 0, delay: 20_000, duration: 1000, onComplete: () => paper.destroy() })

    for (let i = 0; i < 3; i++) {
      const puff = this.scene.add.sprite(x + DESK_W / 2 - 34, y + 60, 'itens', ITEM.fumaca).setScale(SCALE * 0.6).setDepth(16).setAlpha(0)
      this.scene.tweens.add({
        targets: puff,
        delay: i * 250,
        y: y + 10,
        x: puff.x + (i - 1) * 10,
        alpha: { from: 0.9, to: 0 },
        scale: SCALE * 1.2,
        duration: 1400,
        onComplete: () => puff.destroy()
      })
    }
  }

  /** Posição (em coordenadas do mundo) de cada liderado em volta da mesa. */
  private slot(i: number, x = this.root.x, y = this.root.y): { x: number; y: number } {
    const col = i % 2
    const row = Math.floor(i / 2)
    return { x: x + 20 + col * 34, y: y + 70 + row * 34 }
  }

  /** Fase 5: liderados entram pela porta, ficam perto do chefe e saem ao terminar. */
  private updateTeam(subagents: SubagentState[]): void {
    const alive = new Set(subagents.map((a) => a.id))
    for (const [id, sub] of this.team) {
      if (!alive.has(id)) {
        this.team.delete(id)
        this.leaveThroughDoor(sub)
      }
    }
    const used = new Set([...this.team.values()].map((s) => s.slot))
    for (const a of subagents) {
      let sub = this.team.get(a.id)
      if (!sub) {
        let slot = 0
        while (used.has(slot)) slot++
        used.add(slot)
        const seniority = seniorityFor(a.model)
        const sprite = this.scene.add.sprite(this.door.x, this.door.y, personKey(seniority), 8).setScale(SCALE).setOrigin(0.5, 1).setDepth(20)
        const label = this.scene.add
          .text(this.door.x, this.door.y, (a.agentType ?? 'agente').split(/[-_ ]/)[0]!.slice(0, 9), { fontFamily: FONT, fontSize: '9px', color: '#e8e6e3', backgroundColor: '#1d1f27aa', padding: { x: 2, y: 1 } })
          .setOrigin(0.5, 0)
          .setDepth(21)
        sub = { sprite, label, seniority, arrived: false, slot }
        this.team.set(a.id, sub)
        this.walk(sub, this.slot(slot), () => {
          sub!.arrived = true
        })
      }
      if (sub.arrived) {
        // Trabalhando: anima no lugar; sem ferramenta: parado.
        if (a.currentTool) sub.sprite.play(animKey(sub.seniority, 'digitando'), true)
        else sub.sprite.stop().setFrame(8)
      }
    }
  }

  private walk(sub: Subordinate, to: { x: number; y: number }, done?: () => void): void {
    const distance = Phaser.Math.Distance.Between(sub.sprite.x, sub.sprite.y, to.x, to.y)
    const duration = Math.max(200, (distance / WALK_SPEED) * 1000)
    sub.sprite.play(animKey(sub.seniority, 'andando'), true)
    sub.sprite.setFlipX(to.x < sub.sprite.x)
    this.scene.tweens.killTweensOf([sub.sprite, sub.label])
    this.scene.tweens.add({
      targets: sub.sprite,
      x: to.x,
      y: to.y,
      duration,
      onComplete: () => {
        sub.sprite.stop().setFrame(8).setFlipX(false)
        done?.()
      }
    })
    this.scene.tweens.add({ targets: sub.label, x: to.x, y: to.y + 1, duration })
  }

  private leaveThroughDoor(sub: Subordinate): void {
    sub.arrived = false
    this.walk(sub, this.door, () => {
      this.scene.tweens.add({
        targets: [sub.sprite, sub.label],
        alpha: 0,
        duration: 250,
        onComplete: () => {
          sub.sprite.destroy()
          sub.label.destroy()
        }
      })
    })
  }

  leave(): void {
    for (const sub of this.team.values()) this.leaveThroughDoor(sub)
    this.team.clear()
    this.scene.tweens.killTweensOf([this.zzz, this.sweat, this.postits])
    this.scene.tweens.add({
      targets: this.root,
      alpha: 0,
      duration: 400,
      onComplete: () => this.root.destroy()
    })
  }
}
