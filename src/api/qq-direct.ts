import type { Playlist, Song } from '@/types'
import { getDesktop, unwrapDesktopResult } from '@/platform/desktop'

type Json = Record<string, any>

function desktop() {
  const bridge = getDesktop()
  if (!bridge) throw new Error('QQ 音乐目前只在桌面版中可用')
  return bridge
}

async function request(url: string, method: 'GET' | 'POST' = 'GET', body = ''): Promise<Json> {
  const response = unwrapDesktopResult(await desktop().fetchQq(url, method, body))
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`QQ 音乐接口请求失败（HTTP ${response.status}）`)
  }
  try {
    const data = JSON.parse(response.body)
    if (!data || typeof data !== 'object') throw new Error('not object')
    return data
  } catch {
    throw new Error('QQ 音乐接口没有返回有效 JSON')
  }
}

function positiveId(value: unknown): number {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : 0
}

function qqComm(userId: string, musicKey: string): Json {
  return {
    uin: userId,
    authst: musicKey,
    format: 'json',
    inCharset: 'utf-8',
    outCharset: 'utf-8',
    notice: 0,
    platform: 'yqq.json',
    need_new_code: 1,
    ct: 24,
    cv: 4747474,
  }
}

async function session(): Promise<{ userId: string; musicKey: string }> {
  const state = unwrapDesktopResult(await desktop().getQqSessionState())
  if (!state.userId || !state.hasMusicKey) throw new Error('请先登录 QQ 音乐')
  // The credential is held in the Rust process. This marker is replaced by
  // fetch_qq, which inserts authst into the request before it leaves the app.
  return { userId: state.userId, musicKey: '' }
}

async function musicRequest(module: string, method: string, param: Json, write = false): Promise<Json> {
  const { userId, musicKey } = await session()
  const payload = JSON.stringify({
    comm: qqComm(userId, musicKey),
    req_0: { module, method, param },
  })
  const raw = await request('https://u.y.qq.com/cgi-bin/musicu.fcg', 'POST', payload)
  const block = raw.req_0
  if (raw.code !== 0 || !block || block.code !== 0) {
    throw new Error(`QQ 音乐 ${method} 失败（${raw.code ?? '-'} / ${block?.code ?? '-'}）`)
  }
  const data = block.data || {}
  if (typeof data.code === 'number' && data.code !== 0) {
    throw new Error(`QQ 音乐 ${method} 失败（业务码 ${data.code}）`)
  }
  if (typeof data.subcode === 'number' && data.subcode !== 0) {
    throw new Error(`QQ 音乐 ${method} 失败（子码 ${data.subcode}）`)
  }
  if (write && data.retCode !== 0) {
    throw new Error(`QQ 音乐 ${method} 未确认成功（retCode ${data.retCode ?? '缺失'}）`)
  }
  return data
}

function profileUrl(userId: string): string {
  const url = new URL('https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg')
  Object.entries({
    cid: '205360838', userid: userId, reqfrom: '1', g_tk: '5381',
    loginUin: userId, hostUin: '0', format: 'json', inCharset: 'utf8',
    outCharset: 'utf-8', notice: '0', platform: 'yqq.json', needNewCode: '0',
  }).forEach(([key, value]) => url.searchParams.set(key, value))
  return url.toString()
}

export async function getQqLoginStatus(): Promise<{ userId: string; nickname: string } | null> {
  const state = unwrapDesktopResult(await desktop().getQqSessionState())
  if (!state.userId || !state.hasMusicKey) return null
  const raw = await request(profileUrl(state.userId))
  if (raw.code === 1000 || raw.result === 301) return null
  if (raw.code !== 0) throw new Error(`QQ 音乐账号验证失败（${raw.code ?? '-'}）`)
  const data = raw.data || {}
  const creator = data.creator || data.userinfo || data
  return {
    userId: state.userId,
    nickname: String(creator.nick || creator.nickname || creator.name || state.userId),
  }
}

export async function startQqQrLogin(): Promise<string> {
  return unwrapDesktopResult(await desktop().startQqQrLogin()).image
}

export async function pollQqQrLogin(): Promise<'waiting' | 'scanned' | 'expired' | 'success'> {
  return unwrapDesktopResult(await desktop().pollQqQrLogin()).status
}

function listUrl(userId: string, kind: 'created' | 'collected', offset: number): string {
  const url = new URL(kind === 'created'
    ? 'https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss'
    : 'https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg')
  const params = kind === 'created'
    ? { hostUin: '0', hostuin: userId, sin: String(offset), size: '200',
        g_tk: '5381', loginUin: userId, format: 'json', inCharset: 'utf8',
        outCharset: 'utf-8', notice: '0', platform: 'yqq.json', needNewCode: '0' }
    : { ct: '20', cid: '205360956', userid: userId, reqtype: '3',
        sin: String(offset), ein: String(offset + 79), format: 'json' }
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  return url.toString()
}

function mapPlaylist(raw: Json, kind: 'created' | 'collected', userId: string): Playlist | null {
  const id = kind === 'created' && positiveId(raw.dirid) === 201
    ? 201 : positiveId(raw.dissid || raw.tid || raw.dirid || raw.id || raw.diss_id)
  if (!id) return null
  const name = String(raw.diss_name || raw.dissname || raw.name || raw.title || '').trim()
  if (!name) return null
  return {
    id,
    platform: 'qq',
    name,
    trackCount: Number(raw.song_cnt || raw.songnum || raw.total_song_num || raw.song_count || 0),
    coverImgUrl: String(raw.diss_cover || raw.logo || raw.picurl || raw.cover || ''),
    creator: { userId: kind === 'created' ? Number(userId) : 0,
      nickname: String(raw.hostname || raw.nick || raw.nickname || 'QQ 音乐') },
    subscribed: kind === 'collected',
    dirId: positiveId(raw.dirid),
    tid: positiveId(raw.tid || raw.dissid),
  }
}

export async function getQqUserPlaylists(): Promise<Playlist[]> {
  const state = unwrapDesktopResult(await desktop().getQqSessionState())
  if (!state.userId || !state.hasMusicKey) throw new Error('请先登录 QQ 音乐')
  const all: Playlist[] = []
  for (const kind of ['created', 'collected'] as const) {
    const pageSize = kind === 'created' ? 200 : 80
    for (let offset = 0; offset < 2000; offset += pageSize) {
      const raw = await request(listUrl(state.userId, kind, offset))
      if (raw.code !== 0) throw new Error(`读取 QQ ${kind === 'created' ? '创建' : '收藏'}歌单失败（${raw.code ?? '-'}）`)
      const rows = kind === 'created' ? raw.data?.disslist : raw.data?.cdlist
      if (!Array.isArray(rows)) throw new Error('QQ 歌单列表返回格式已变化')
      all.push(...rows.map((item: Json) => mapPlaylist(item, kind, state.userId!)).filter((p: Playlist | null): p is Playlist => !!p))
      if (rows.length < pageSize) break
    }
  }
  const unique = new Map<number, Playlist>()
  for (const playlist of all) if (!unique.has(playlist.id)) unique.set(playlist.id, playlist)
  return Array.from(unique.values())
}

function mapSong(raw: Json): Song | null {
  const track = raw.track_info || raw.songInfo || raw.songinfo || raw.song || raw
  const id = positiveId(track.id || track.songid || raw.id || raw.songid)
  if (!id) return null
  const album = track.album || {}
  const singer = track.singer || track.singers || []
  const artists = Array.isArray(singer) ? singer.map((a: Json) => ({
    id: positiveId(a.id), name: String(a.name || a.title || ''),
  })).filter((a) => a.name) : []
  return {
    id, platform: 'qq', mid: String(track.mid || track.songmid || ''),
    songType: typeof track.type === 'number' ? track.type
      : typeof track.songtype === 'number' ? track.songtype : undefined,
    name: String(track.name || track.songname || raw.name || ''),
    artists,
    album: {
      id: positiveId(album.id), name: String(album.name || album.title || track.albumname || ''),
      publishTime: album.time_public ? Date.parse(album.time_public) : undefined,
    },
    duration: Number(track.interval || 0) * 1000,
  }
}

export async function getQqPlaylistSongs(playlistId: number): Promise<Song[]> {
  if (!positiveId(playlistId)) throw new Error('QQ 歌单 ID 无效')
  const all: Song[] = []
  for (let offset = 0; offset < 100_000; offset += 100) {
    const data = await musicRequest('music.srfDissInfo.DissInfo', 'CgiGetDiss', {
      disstid: playlistId === 201 ? 0 : playlistId,
      dirid: playlistId === 201 ? 201 : 0,
      tag: true, song_begin: offset, song_num: 100, userinfo: true, orderlist: true,
    })
    const rows = data.songlist
    if (!Array.isArray(rows)) throw new Error('QQ 歌单详情返回格式已变化')
    const songs = rows.map(mapSong).filter((s: Song | null): s is Song => !!s)
    if (songs.length !== rows.length) throw new Error('QQ 歌单有曲目缺少数字 ID，已停止以免漏歌')
    all.push(...songs)
    const total = Number(data.total_song_num || data.dirinfo?.songnum || 0)
    if (rows.length === 0 || (total > 0 && all.length >= total)
      || data.hasmore === 0 || data.hasmore === false
      || (data.hasmore === undefined && rows.length < 100)) break
  }
  return all
}

export async function createQqPlaylist(name: string): Promise<number> {
  if (!name.trim() || name.length > 20) throw new Error('QQ 音乐歌单名称需在 1–20 字以内')
  const data = await musicRequest('music.musicasset.PlaylistBaseWrite', 'AddPlaylist', {
    dirName: name.trim(), dirDesc: '', dirPicUrl: '', taglist: '', dirShow: 2,
  }, true)
  const id = positiveId(data.result?.tid || data.result?.dirId)
  if (!id) throw new Error('QQ 音乐已响应创建，但未返回歌单 ID；请先检查账号歌单，避免重复创建')
  const found = (await getQqUserPlaylists()).find((p) =>
    (p.id === id || p.tid === id || p.dirId === id) && p.name === name.trim() && !p.subscribed)
  if (!found) throw new Error('QQ 音乐已响应创建，但读回歌单失败；请先检查账号歌单，避免重复创建')
  return found.id
}

export async function addQqSongsToPlaylist(playlistId: number, songs: Song[]): Promise<void> {
  const playlist = (await getQqUserPlaylists()).find((p) => p.id === playlistId && !p.subscribed)
  if (!playlist || !playlist.dirId || !playlist.tid || playlist.dirId <= 206) {
    throw new Error('无法确认目标是本人创建的普通 QQ 歌单，已停止写入')
  }
  if (songs.some((s) => s.platform !== 'qq' || !positiveId(s.id) || s.songType === undefined)) {
    throw new Error('存在缺少 QQ 歌曲 ID 或类型的曲目，已停止写入')
  }
  const before = await getQqPlaylistSongs(playlistId)
  const existing = new Set(before.map((s) => `${s.id}:${s.songType}`))
  const pending = Array.from(new Map(songs.filter((s) => !existing.has(`${s.id}:${s.songType}`))
    .map((s) => [`${s.id}:${s.songType}`, s])).values())
  for (let i = 0; i < pending.length; i += 100) {
    const batch = pending.slice(i, i + 100)
    await musicRequest('music.musicasset.PlaylistDetailWrite', 'AddSonglist', {
      dirId: playlist.dirId, tid: playlist.tid, bFmtUtf8: true,
      v_songInfo: batch.map((s) => ({ songId: s.id, songType: s.songType })),
    }, true)
  }
  const after = await getQqPlaylistSongs(playlistId)
  const actual = new Set(after.map((s) => `${s.id}:${s.songType}`))
  const missing = songs.filter((s) => !actual.has(`${s.id}:${s.songType}`))
  if (missing.length) throw new Error(`QQ 音乐写入后读回仍缺少 ${missing.length} 首，未标记成功`)
}
