/// <reference types="vite/client" />
import type { OfficeApi } from '@shared/types'

declare global {
  interface Window {
    office: OfficeApi
  }
}

export {}
