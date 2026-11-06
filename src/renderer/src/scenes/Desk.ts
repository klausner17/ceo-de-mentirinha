// Uma mesa: funcionário, crachá de senioridade, pilha de papel, ferramenta em uso e liderados.

import Phaser from 'phaser'
import type { Seniority, SessionState } from '@shared/types'
import { describeTool } from '../tools'

export const DESK_W = 230
export const DESK_H = 170

/** Contexto de referência para a pilha cheia (folhas de 20 mil tokens). */
const FULL_CONTEXT = 200_000
const SHEET_TOKENS = 20_000
const MAX_SHEETS = 10

const SENIORITY: Record<Seniority, { color: number; badge: string }> = {
  diretor: { color: 0xc792ea, badge: 'DIRETOR' },
  pleno: { color: 0x82aaff, badge: 'PLENO' },
  junior: { color: 0x89ddff, badge: 'JÚNIOR' },
  desconhecido: { color: 0xa6accd, badge: '???' }
}

export const FONT = '-apple-system, "Segoe UI", system-ui, sans-serif'

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

export class Desk {
  private readonly root: Phaser.GameObjects.Container
  private readonly person: Phaser.GameObjects.Arc
  private readonly badge: Phaser.GameObjects.Text
  private readonly title: Phaser.GameObjects.Text
  private readonly subtitle: Phaser.GameObjects.Text
  private readonly tool: Phaser.GameObjects.Text
  private readonly zzz: Phaser.GameObjects.Text
  private readonly papers: Phaser.GameObjects.Container
  private readonly team: Phaser.GameObjects.Container
  private readonly bob: Phaser.Tweens.Tween
  private readonly snore: Phaser.Tweens.Tween

  constructor(private readonly scene: Phaser.Scene, x: number, y: number) {
    const bg = scene.add.rectangle(0, 0, DESK_W, DESK_H, 0x2f3442).setOrigin(0).setStrokeStyle(1, 0x454b5c)
    const table = scene.add.rectangle(20, 92, DESK_W - 40, 34, 0x8b5e3c).setOrigin(0).setStrokeStyle(2, 0x5c3d26)
    const monitor = scene.add.rectangle(DESK_W / 2 - 22, 78, 44, 20, 0x1b1d24).setOrigin(0).setStrokeStyle(2, 0x0e0f13)

    this.person = scene.add.circle(DESK_W / 2, 62, 16, SENIORITY.desconhecido.color).setStrokeStyle(2, 0x1d1f27)
    this.badge = scene.add
      .text(DESK_W / 2, 36, '', { fontFamily: FONT, fontSize: '10px', fontStyle: 'bold', color: '#1d1f27', backgroundColor: '#e8e6e3', padding: { x: 4, y: 1 } })
      .setOrigin(0.5)
    this.tool = scene.add
      .text(DESK_W / 2, 14, '', { fontFamily: FONT, fontSize: '12px', color: '#1d1f27', backgroundColor: '#f2c66d', padding: { x: 6, y: 2 } })
      .setOrigin(0.5)
    this.zzz = scene.add.text(DESK_W / 2 + 22, 50, 'z z z', { fontFamily: FONT, fontSize: '14px', color: '#7d8590' }).setVisible(false)

    this.papers = scene.add.container(DESK_W - 52, 118)
    this.team = scene.add.container(16, 40)

    this.title = scene.add.text(10, 132, '', { fontFamily: FONT, fontSize: '13px', fontStyle: 'bold', color: '#e8e6e3' })
    this.subtitle = scene.add.text(10, 150, '', { fontFamily: FONT, fontSize: '11px', color: '#9aa1b2' })

    this.root = scene.add.container(x, y, [
      bg, table, monitor, this.person, this.badge, this.papers, this.team, this.tool, this.zzz, this.title, this.subtitle
    ])
    this.root.setDepth(1).setAlpha(0)
    scene.tweens.add({ targets: this.root, alpha: 1, duration: 300 })

    this.bob = scene.tweens.add({ targets: this.person, y: 58, duration: 260, yoyo: true, repeat: -1, paused: true })
    this.snore = scene.tweens.add({ targets: this.zzz, y: 40, alpha: 0.3, duration: 1200, yoyo: true, repeat: -1, paused: true })
  }

  moveTo(x: number, y: number): void {
    if (this.root.x === x && this.root.y === y) return
    this.scene.tweens.add({ targets: this.root, x, y, duration: 250, ease: 'Sine.easeOut' })
  }

  update(s: SessionState): void {
    const sen = SENIORITY[s.seniority]
    const idle = s.status === 'ocioso'

    this.person.setFillStyle(sen.color, idle ? 0.45 : 1)
    this.badge.setText(sen.badge)
    fit(this.title, s.title ?? s.id.slice(0, 8), DESK_W - 20)
    fit(this.subtitle, `${s.branch ?? 'sem branch'} · ${shortModel(s.model)}`, DESK_W - 20)

    if (s.currentTool) {
      const t = describeTool(s.currentTool.name)
      this.tool.setText(t.label).setBackgroundColor(t.color).setVisible(true)
      if (this.bob.isPaused()) this.bob.resume()
    } else {
      this.tool.setVisible(false)
      if (!this.bob.isPaused()) this.bob.pause()
      this.person.y = 62
    }

    this.zzz.setVisible(idle)
    if (idle && this.snore.isPaused()) this.snore.resume()
    if (!idle && !this.snore.isPaused()) this.snore.pause()

    this.drawPapers(s.contextTokens)
    this.drawTeam(s)
  }

  /** Pilha de papel: uma folha a cada 20 mil tokens de contexto, até 10. */
  private drawPapers(tokens: number): void {
    this.papers.removeAll(true)
    const sheets = Math.min(MAX_SHEETS, Math.ceil(tokens / SHEET_TOKENS))
    const nearlyFull = tokens >= FULL_CONTEXT * 0.8
    for (let i = 0; i < sheets; i++) {
      const sheet = this.scene.add
        .rectangle((i % 2) * 2, -i * 3, 26, 8, nearlyFull ? 0xffd6d6 : 0xf4f1ea)
        .setOrigin(0)
        .setStrokeStyle(1, 0xb9b4a8)
      this.papers.add(sheet)
    }
    const label = this.scene.add
      .text(-4, 0, `${Math.round(tokens / 1000)}k`, { fontFamily: FONT, fontSize: '10px', color: '#e8e6e3' })
      .setOrigin(1, 0.5)
    this.papers.add(label)
  }

  /** Liderados (subagentes) em volta da mesa do chefe. */
  private drawTeam(s: SessionState): void {
    this.team.removeAll(true)
    s.subagents.slice(0, 6).forEach((a, i) => {
      const cx = (i % 2) * 22
      const cy = Math.floor(i / 2) * 24
      const busy = a.currentTool !== null
      const dot = this.scene.add.circle(cx + 8, cy + 8, 8, busy ? 0x7ee787 : 0x56d364, busy ? 1 : 0.6).setStrokeStyle(1, 0x1d1f27)
      const initial = this.scene.add
        .text(cx + 8, cy + 8, (a.agentType ?? 'a').slice(0, 1).toUpperCase(), { fontFamily: FONT, fontSize: '10px', color: '#1d1f27', fontStyle: 'bold' })
        .setOrigin(0.5)
      this.team.add([dot, initial])
    })
    if (s.subagents.length > 6) {
      this.team.add(this.scene.add.text(0, 76, `+${s.subagents.length - 6}`, { fontFamily: FONT, fontSize: '10px', color: '#9aa1b2' }))
    }
  }

  leave(): void {
    this.bob.remove()
    this.snore.remove()
    this.scene.tweens.add({
      targets: this.root,
      alpha: 0,
      duration: 300,
      onComplete: () => this.root.destroy()
    })
  }
}
