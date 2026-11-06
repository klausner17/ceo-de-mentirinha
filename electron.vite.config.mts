import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'electron-vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

const shared = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    // chokidar 6 é só ESM; empacotamos junto para o processo principal continuar em CommonJS.
    build: { externalizeDeps: { exclude: ['chokidar'] } }
  },
  preload: {
    resolve: { alias: shared }
  },
  renderer: {
    resolve: { alias: shared }
  }
})
