// Lê só o que foi acrescentado a cada arquivo desde a última leitura.
// Uma linha sem "\n" no fim (JSON ainda sendo escrito) fica para a próxima vez.

import { open } from 'node:fs/promises'

interface FileCursor {
  offset: number
  /** Bytes de uma linha incompleta lida na última vez. */
  remainder: Buffer
}

export class IncrementalReader {
  private readonly cursors = new Map<string, FileCursor>()
  /** Enfileira as leituras de um mesmo arquivo para nunca rodarem em paralelo. */
  private readonly chains = new Map<string, Promise<unknown>>()

  /** Devolve as linhas completas novas do arquivo. */
  readNewLines(path: string): Promise<string[]> {
    const previous = this.chains.get(path) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(() => this.read(path))
    this.chains.set(path, next)
    return next
  }

  /** Esquece a posição de um arquivo (por exemplo, quando ele é apagado). */
  forget(path: string): void {
    this.cursors.delete(path)
    this.chains.delete(path)
  }

  private async read(path: string): Promise<string[]> {
    let cursor = this.cursors.get(path)
    if (!cursor) {
      cursor = { offset: 0, remainder: Buffer.alloc(0) }
      this.cursors.set(path, cursor)
    }

    const handle = await open(path, 'r')
    try {
      const { size } = await handle.stat()
      if (size < cursor.offset) {
        // Arquivo truncado ou recriado: recomeça do zero.
        cursor.offset = 0
        cursor.remainder = Buffer.alloc(0)
      }
      if (size === cursor.offset) return []

      const length = size - cursor.offset
      const chunk = Buffer.alloc(length)
      const { bytesRead } = await handle.read(chunk, 0, length, cursor.offset)
      cursor.offset += bytesRead

      const data = Buffer.concat([cursor.remainder, chunk.subarray(0, bytesRead)])
      const lastNewline = data.lastIndexOf(0x0a)
      if (lastNewline === -1) {
        cursor.remainder = data
        return []
      }
      cursor.remainder = Buffer.from(data.subarray(lastNewline + 1))
      return data
        .subarray(0, lastNewline)
        .toString('utf8')
        .split('\n')
        .filter((l) => l.trim() !== '')
    } finally {
      await handle.close()
    }
  }
}
