import type { ForgeApi } from '@shared/api'

declare global {
  interface Window {
    forge: ForgeApi
  }
}

export {}
