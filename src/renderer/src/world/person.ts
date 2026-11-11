// Uma pessoa feita de blocos (pernas, tronco, braços e cabeça) com as poses do escritório:
// sentada digitando, lendo, procurando, dormindo, apontando, andando ou parada de pé.
// As cores seguem a pixel art: a roupa diz a senioridade (o modelo).

import * as THREE from 'three'
import type { Pose } from '../art'
import { box, mat } from './kit'

export type Look = 'diretor' | 'pleno' | 'junior' | 'desconhecido' | 'officeboy' | 'ceo'

/** Cabelo, roupa e detalhe (gravata, boné), as mesmas cores de scripts/gerar-arte.mjs. */
const COLORS: Record<Look, { hair: string; shirt: string; detail: string; pants: string }> = {
  diretor: { hair: '#4a3426', shirt: '#5b3f8c', detail: '#e8c35b', pants: '#3b3f4f' },
  pleno: { hair: '#2b2b2b', shirt: '#3f6fb5', detail: '#f4f1ea', pants: '#3b3f4f' },
  junior: { hair: '#c9873e', shirt: '#4fb3a9', detail: '#f4f1ea', pants: '#3b3f4f' },
  desconhecido: { hair: '#6b6b6b', shirt: '#7d8590', detail: '#cfd3da', pants: '#3b3f4f' },
  officeboy: { hair: '#c0392b', shirt: '#e8b923', detail: '#c0392b', pants: '#5f6672' },
  // Você: terno escuro com gravata dourada.
  ceo: { hair: '#3a2a20', shirt: '#2f3e66', detail: '#e8c35b', pants: '#232838' }
}
const SKIN = '#f1c27d'
const DARK = '#1d1f27'

/** Pose sentada ou andando, mais duas de pé: "parado" e "prancheta" (trabalhando em pé). */
export type PersonPose = Pose | 'parado' | 'prancheta'

/** Altura do assento da cadeira (onde fica o quadril de quem senta). */
export const SEAT = 0.42
const HIP = 0.5

export class Person {
  readonly root = new THREE.Group()
  /** Tudo o que se mexe junto (abaixa ao sentar). */
  private readonly body = new THREE.Group()
  private readonly torso = new THREE.Group()
  private readonly head = new THREE.Group()
  private readonly legL = new THREE.Group()
  private readonly legR = new THREE.Group()
  private readonly armL = new THREE.Group()
  private readonly armR = new THREE.Group()
  private pose: PersonPose = 'parado'
  private phase = Math.random() * 10
  look: Look

  constructor(look: Look, scale = 1) {
    this.look = look
    this.root.add(this.body)
    this.body.add(this.legL, this.legR, this.torso)
    this.torso.add(this.armL, this.armR, this.head)
    this.root.scale.setScalar(scale)
    this.build()
  }

  private build(): void {
    const c = COLORS[this.look]
    // Tira só as peças (o tronco também carrega os grupos dos braços e da cabeça).
    for (const g of [this.legL, this.legR, this.torso, this.head, this.armL, this.armR]) {
      for (const c of [...g.children]) if (c instanceof THREE.Mesh) c.removeFromParent()
    }

    // Pernas: o pivô fica no quadril.
    this.legL.position.set(-0.11, HIP, 0)
    this.legR.position.set(0.11, HIP, 0)
    for (const leg of [this.legL, this.legR]) {
      leg.add(box(0.16, 0.46, 0.18, mat(c.pants), [0, -0.23, 0]))
      leg.add(box(0.17, 0.07, 0.24, mat(DARK), [0, -0.47, 0.03]))
    }

    // Tronco: o pivô fica no quadril, para inclinar inteiro ao dormir.
    this.torso.position.set(0, HIP, 0)
    this.torso.add(box(0.44, 0.48, 0.26, mat(c.shirt), [0, 0.24, 0]))
    if (this.look === 'officeboy') {
      // Uniforme com faixa.
      this.torso.add(box(0.45, 0.06, 0.27, mat(c.detail), [0, 0.3, 0]))
    } else {
      // Gravata (ou detalhe da camisa) na frente.
      this.torso.add(box(0.07, 0.3, 0.02, mat(c.detail), [0, 0.28, 0.135]))
    }

    // Braços: o pivô fica no ombro.
    this.armL.position.set(-0.29, 0.44, 0)
    this.armR.position.set(0.29, 0.44, 0)
    for (const arm of [this.armL, this.armR]) {
      arm.add(box(0.13, 0.36, 0.15, mat(c.shirt), [0, -0.18, 0]))
      arm.add(box(0.12, 0.09, 0.13, mat(SKIN), [0, -0.4, 0]))
    }

    // Cabeça, cabelo (ou boné) e olhos na frente.
    this.head.position.set(0, 0.48, 0)
    this.head.add(box(0.36, 0.34, 0.34, mat(SKIN), [0, 0.2, 0]))
    this.head.add(box(0.38, 0.1, 0.36, mat(c.hair), [0, 0.39, 0]))
    this.head.add(box(0.38, 0.22, 0.08, mat(c.hair), [0, 0.28, -0.15]))
    if (this.look === 'officeboy') this.head.add(box(0.3, 0.04, 0.16, mat(c.hair), [0, 0.35, 0.24]))
    for (const x of [-0.08, 0.08]) this.head.add(box(0.05, 0.06, 0.02, mat(DARK), [x, 0.22, 0.175]))
  }

  /** Troca a roupa (a senioridade mudou). */
  setLook(look: Look): void {
    if (look === this.look) return
    this.look = look
    this.build()
  }

  setPose(pose: PersonPose): void {
    this.pose = pose
  }

  getPose(): PersonPose {
    return this.pose
  }

  /** Mexe pernas, braços e cabeça conforme a pose. Chamar a cada quadro. */
  update(dt: number): void {
    this.phase += dt
    const t = this.phase
    const seated = this.pose !== 'andando' && this.pose !== 'parado' && this.pose !== 'prancheta'
    // Sentado: o quadril desce até o assento e as pernas apontam para a frente.
    this.body.position.y = seated ? SEAT - HIP : 0
    const legs = seated ? -Math.PI / 2 : 0
    this.legL.rotation.set(legs, 0, 0)
    this.legR.rotation.set(legs, 0, 0)
    this.torso.rotation.set(0, 0, 0)
    this.head.rotation.set(0, 0, 0)
    this.armL.rotation.set(0, 0, 0)
    this.armR.rotation.set(0, 0, 0)

    switch (this.pose) {
      case 'andando': {
        const swing = Math.sin(t * 11) * 0.45
        this.legL.rotation.x = swing
        this.legR.rotation.x = -swing
        this.armL.rotation.x = -swing * 0.8
        this.armR.rotation.x = swing * 0.8
        this.body.position.y = Math.abs(Math.cos(t * 11)) * 0.04
        break
      }
      case 'parado':
        this.torso.rotation.x = Math.sin(t * 1.6) * 0.015
        break
      case 'prancheta':
        this.armL.rotation.x = -1.0 + Math.sin(t * 9) * 0.1
        this.armR.rotation.x = -1.0 - Math.sin(t * 9) * 0.1
        this.head.rotation.x = 0.2
        break
      case 'sentado':
        this.armL.rotation.x = this.armR.rotation.x = -0.9
        break
      case 'digitando':
        this.armL.rotation.x = -1.15 + Math.sin(t * 18) * 0.12
        this.armR.rotation.x = -1.15 - Math.sin(t * 18) * 0.12
        this.head.rotation.x = 0.08
        break
      case 'lendo':
        // Segura uma pasta na frente do rosto e vira a página de vez em quando.
        this.armL.rotation.set(-1.5, 0, -0.25)
        this.armR.rotation.set(-1.5 + Math.max(0, Math.sin(t * 1.5)) * 0.3, 0, 0.25)
        this.head.rotation.x = 0.25
        break
      case 'procurando':
        this.head.rotation.y = Math.sin(t * 2.4) * 0.6
        this.armR.rotation.x = -1.1
        this.armL.rotation.x = -0.6
        this.torso.rotation.x = 0.12
        break
      case 'dormindo':
        // Cabeça na mesa.
        this.torso.rotation.x = 0.55 + Math.sin(t * 1.2) * 0.02
        this.head.rotation.x = 0.4
        this.armL.rotation.x = this.armR.rotation.x = -1.5
        break
      case 'apontando':
        this.armR.rotation.set(-2.6 + Math.sin(t * 3) * 0.15, 0, 0)
        this.armL.rotation.x = -0.6
        break
    }
  }
}
