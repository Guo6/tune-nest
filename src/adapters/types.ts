import type { Playlist, Song } from '@/types'

export type MusicPlatform = 'netease' | 'qq'
export type QrStatus = 'waiting' | 'scanned' | 'expired' | 'success'

export interface MusicPlatformAdapter {
  readonly platform: MusicPlatform
  readonly name: string
  getLoginStatus(): Promise<{ userId: number; nickname: string } | null>
  startQrLogin(): Promise<{ image: string; key?: string }>
  pollQrLogin(key?: string): Promise<QrStatus>
  getUserPlaylists(userId: number): Promise<Playlist[]>
  getPlaylistSongs(playlistId: number): Promise<Song[]>
  findPlaylistByName(userId: number, name: string): Promise<Playlist | null>
  createPlaylist(name: string): Promise<number>
  addSongsToPlaylist(playlistId: number, songs: Song[]): Promise<void>
  replacePlaylist?(playlistId: number, songs: Song[]): Promise<void>
}
