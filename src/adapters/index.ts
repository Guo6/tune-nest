import type { MusicPlatform, MusicPlatformAdapter } from './types'
import { neteaseAdapter } from './netease-adapter'
import { qqAdapter } from './qq-adapter'

export function getMusicAdapter(platform: MusicPlatform): MusicPlatformAdapter {
  return platform === 'qq' ? qqAdapter : neteaseAdapter
}

export type { MusicPlatform, MusicPlatformAdapter } from './types'
