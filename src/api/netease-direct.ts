import type { Playlist, Song, Artist, Album } from '@/types'
import { getCreatedPlaylistId, requestNetease } from './netease-request'
import { getDesktop, unwrapDesktopResult } from '@/platform/desktop'
import { makeQrDataUrl } from '@/utils/qr'

function getCsrf(): string {
  const match = document.cookie.match(/(?:^|;\s*)__csrf=([^;]+)/)
  return match?.[1] || ''
}

async function req<T>(
  path: string,
  params: Record<string, string | number> = {},
  method: 'GET' | 'POST' = 'POST',
  acceptedCodes: number[] = [],
): Promise<T> {
  const desktop = getDesktop()
  if (desktop) {
    const csrf = unwrapDesktopResult(await desktop.getNeteaseCsrf())
    return requestNetease<T>(path, params, csrf, method, async (url, options) => {
      const headers = Object.fromEntries(new Headers(options.headers).entries())
      const response = unwrapDesktopResult(await desktop.fetchNetease(url, options.method || method, String(options.body || ''), headers))
      return new Response(response.body, { status: response.status })
    }, acceptedCodes)
  }
  return requestNetease<T>(path, params, getCsrf(), method, (url, options) => fetch(url, options), acceptedCodes)
}

export interface NeteaseQrStatus { code: number; message?: string; cookie?: string }

export async function startNeteaseQrLogin(): Promise<{ key: string; image: string }> {
  let keyResponse: { data?: { unikey?: string }; unikey?: string }
  try {
    keyResponse = await req<{ data?: { unikey?: string }; unikey?: string }>(
    '/api/login/qrcode/unikey', { type: 1 }
    )
  } catch (error) {
    throw new Error(`获取二维码密钥失败（weapi/login/qrcode/unikey）：${error instanceof Error ? error.message : String(error)}`)
  }
  const key = keyResponse.data?.unikey || keyResponse.unikey
  if (!key) throw new Error('网易云没有返回二维码密钥')
  // NetEase's QR content is a login URL; there is no upstream "create image"
  // endpoint. Generate the QR locally so the unikey is never sent to a third party.
  return { key, image: makeQrDataUrl(`https://music.163.com/login?codekey=${encodeURIComponent(key)}`) }
}

export async function checkNeteaseQrLogin(key: string): Promise<NeteaseQrStatus> {
  const result = await req<NeteaseQrStatus>(
    '/api/login/qrcode/client/login', { key, type: 1 }, 'POST', [800, 801, 802, 803]
  ).catch((error: unknown) => {
    throw new Error(`查询扫码状态失败（weapi/login/qrcode/client/login）：${error instanceof Error ? error.message : String(error)}`)
  })
  if (result.code === 803 && result.cookie) {
    const desktop = getDesktop()
    if (desktop) unwrapDesktopResult(await desktop.storeNeteaseCookie(result.cookie))
  }
  return result
}

export async function getLoginStatusDirect(): Promise<{ userId: number; nickname: string } | null> {
  try {
    const res = await req<Record<string, unknown>>('/api/w/nuser/account/get')
    // 尝试多种响应格式
    const profile = (res as any)?.data?.profile || (res as any)?.profile || null
    return profile
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err.code === 301 || err.code === 401 || err.code === 404)) return null
    throw err
  }
}

export async function getUserPlaylistsDirect(uid: number): Promise<Playlist[]> {
  const res = await req<{ playlist?: Playlist[] }>(
    '/api/user/playlist',
    { uid, limit: 1000, offset: 0 }
  )
  return res.playlist || []
}

export async function getPlaylistDetailDirect(id: number): Promise<Song[]> {
  const res = await req<{
    playlist?: {
      trackIds?: Array<{ id: number }>
      tracks?: Array<{
        id: number; name: string
        ar: Array<{ id: number; name: string }>
        al: { id: number; name: string; publishTime?: number }
        dt: number
      }>
    }
  }>('/api/v6/playlist/detail', { id, n: 100000 })

  const tracks = res.playlist?.tracks || []

  if (tracks.length === 0 && (res.playlist?.trackIds?.length ?? 0) > 0) {
    const ids = res.playlist!.trackIds!.map((t) => t.id)
    const batched: Song[] = []
    for (let i = 0; i < ids.length; i += 1000) {
      const part = await getSongDetailsDirect(ids.slice(i, i + 1000))
      batched.push(...part)
      if (i + 1000 < ids.length) await new Promise((r) => setTimeout(r, 500))
    }
    return batched
  }

  return tracks.map((t) => ({
    id: t.id,
    name: t.name,
    artists: t.ar.map((a): Artist => ({ id: a.id, name: a.name })),
    album: { id: t.al.id, name: t.al.name, publishTime: t.al.publishTime } as Album,
    duration: t.dt,
  }))
}

export async function getSongDetailsDirect(ids: number[]): Promise<Song[]> {
  const c = JSON.stringify(ids.map((id) => ({ id })))
  const res = await req<{
    songs?: Array<{
      id: number; name: string
      ar: Array<{ id: number; name: string }>
      al: { id: number; name: string; publishTime?: number }
      dt: number
    }>
  }>('/api/v3/song/detail', { c })
  return (res.songs || []).map((t) => ({
    id: t.id,
    name: t.name,
    artists: t.ar.map((a): Artist => ({ id: a.id, name: a.name })),
    album: { id: t.al.id, name: t.al.name, publishTime: t.al.publishTime } as Album,
    duration: t.dt,
  }))
}

export async function createPlaylistDirect(name: string): Promise<number> {
  const res = await req<{ id?: number; playlist?: { id: number } }>(
    '/api/playlist/create',
    { name, privacy: 0, type: 'NORMAL' }
  )
  return getCreatedPlaylistId(res)
}

export async function findPlaylistByName(
  uid: number,
  name: string
): Promise<{ id: number; trackCount: number } | null> {
  const playlists = await getUserPlaylistsDirect(uid)
  const found = playlists.find((p) => p.name === name && p.creator.userId === uid)
  return found ? { id: found.id, trackCount: found.trackCount } : null
}

export async function clearPlaylistTracks(pid: number, trackIds: number[]): Promise<void> {
  if (trackIds.length === 0) return
  for (let i = 0; i < trackIds.length; i += 100) {
    await req('/api/playlist/manipulate/tracks', {
      op: 'del',
      pid,
      trackIds: JSON.stringify(trackIds.slice(i, i + 100)),
      imme: 'true',
    })
    if (i + 100 < trackIds.length) await new Promise((r) => setTimeout(r, 500))
  }
}

export async function getPlaylistTrackIds(pid: number): Promise<number[]> {
  const res = await req<{
    playlist?: { trackIds?: Array<{ id: number }> }
  }>('/api/v6/playlist/detail', { id: pid, n: 0 })
  return res.playlist?.trackIds?.map((t) => t.id) || []
}

export async function addSongsToPlaylistDirect(pid: number, trackIds: number[]): Promise<void> {
  await req('/api/playlist/manipulate/tracks', {
    op: 'add',
    pid,
    trackIds: JSON.stringify(trackIds),
    imme: 'true',
  })
}

export interface PlayRecordItem {
  playCount: number
  score: number
  song: Song
}

export async function getPlayRecordDirect(
  uid: number,
  type: 0 | 1 = 0
): Promise<PlayRecordItem[]> {
  const res = await req<Record<string, any>>(
    '/api/v1/play/record',
    { uid, type }
  )

  const rawList: Array<{ playCount: number; score: number; song: any }> =
    type === 0 ? res.allData || [] : res.weekData || []

  return rawList.map((item) => ({
    playCount: item.playCount,
    score: item.score,
    song: {
      id: item.song.id,
      name: item.song.name,
      artists: (item.song.ar || []).map((a: any): Artist => ({ id: a.id, name: a.name })),
      album: {
        id: item.song.al?.id,
        name: item.song.al?.name,
        publishTime: item.song.al?.publishTime,
      } as Album,
      duration: item.song.dt,
    },
  }))
}
