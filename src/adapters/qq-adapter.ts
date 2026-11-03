import type { MusicPlatformAdapter } from './types'
import {
  getQqLoginStatus, startQqQrLogin, pollQqQrLogin,
  getQqUserPlaylists, getQqPlaylistSongs, createQqPlaylist,
  addQqSongsToPlaylist,
} from '@/api/qq-direct'

export const qqAdapter: MusicPlatformAdapter = {
  platform: 'qq',
  name: 'QQ 音乐',
  async getLoginStatus() {
    const profile = await getQqLoginStatus()
    return profile ? { userId: Number(profile.userId), nickname: profile.nickname } : null
  },
  async startQrLogin() { return { image: await startQqQrLogin() } },
  async pollQrLogin() { return pollQqQrLogin() },
  async getUserPlaylists() { return getQqUserPlaylists() },
  getPlaylistSongs: getQqPlaylistSongs,
  async findPlaylistByName(_userId, name) {
    const found = (await getQqUserPlaylists()).filter((p) => !p.subscribed && p.name === name)
    if (found.length > 1) throw new Error(`QQ 音乐存在多个同名歌单“${name}”，请先改名以免写错`)
    return found[0] || null
  },
  createPlaylist: createQqPlaylist,
  addSongsToPlaylist: addQqSongsToPlaylist,
}
