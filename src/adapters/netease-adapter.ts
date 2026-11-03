import type { MusicPlatformAdapter } from './types'
import {
  getLoginStatusDirect, startNeteaseQrLogin, checkNeteaseQrLogin,
  getUserPlaylistsDirect, getPlaylistDetailDirect, findPlaylistByName,
  createPlaylistDirect, addSongsToPlaylistDirect,
  getPlaylistTrackIds, clearPlaylistTracks,
} from '@/api/netease-direct'

export const neteaseAdapter: MusicPlatformAdapter = {
  platform: 'netease',
  name: '网易云音乐',
  getLoginStatus: getLoginStatusDirect,
  startQrLogin: startNeteaseQrLogin,
  async pollQrLogin(key?: string) {
    if (!key) throw new Error('网易云二维码密钥丢失')
    const result = await checkNeteaseQrLogin(key)
    return result.code === 803 ? 'success' : result.code === 802 ? 'scanned'
      : result.code === 800 ? 'expired' : 'waiting'
  },
  getUserPlaylists: getUserPlaylistsDirect,
  getPlaylistSongs: getPlaylistDetailDirect,
  async findPlaylistByName(userId, name) {
    const found = await findPlaylistByName(userId, name)
    return found ? { id: found.id, name, trackCount: found.trackCount,
      coverImgUrl: '', creator: { userId, nickname: '' } } : null
  },
  createPlaylist: createPlaylistDirect,
  async addSongsToPlaylist(playlistId, songs) {
    for (let i = 0; i < songs.length; i += 100) {
      await addSongsToPlaylistDirect(playlistId, songs.slice(i, i + 100).map((s) => s.id))
    }
  },
  async replacePlaylist(playlistId, songs) {
    const oldIds = await getPlaylistTrackIds(playlistId)
    await clearPlaylistTracks(playlistId, oldIds)
    await new Promise((resolve) => setTimeout(resolve, 500))
    await this.addSongsToPlaylist(playlistId, songs)
  },
}
