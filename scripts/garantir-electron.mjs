#!/usr/bin/env node
// Baixa o binário do Electron se o `npm install` não baixou (por exemplo, com
// ignore-scripts ligado). Roda antes de `npm run dev` e `npm start`.

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const dir = dirname(require.resolve('electron/package.json'))
if (!existsSync(join(dir, 'path.txt'))) {
  console.log('Binário do Electron ausente; baixando...')
  const r = spawnSync(process.execPath, [join(dir, 'install.js')], { stdio: 'inherit' })
  process.exit(r.status ?? 1)
}
