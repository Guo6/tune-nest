import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  fetchQq: vi.fn(),
  getQqSessionState: vi.fn(),
}))

vi.mock('@/platform/desktop', () => ({
  getDesktop: () => mock,
  unwrapDesktopResult: (result: { ok: boolean; data?: unknown; error?: { message: string } }) => {
    if (!result.ok) throw new Error(result.error?.message || 'desktop error')
    return result.data
  },
}))

import { createQqPlaylist, getQqPlaylistSongs } from '@/api/qq-direct'

const ok = (body: unknown) => ({ ok: true, data: { status: 200, body: JSON.stringify(body) } })
const block = (data: unknown, code = 0) => ({ code: 0, req_0: { code, data } })

describe('QQ Music API boundary', () => {
  beforeEach(() => {
    mock.fetchQq.mockReset()
    mock.getQqSessionState.mockReset()
    mock.getQqSessionState.mockResolvedValue({ ok: true, data: { userId: '123456', hasMusicKey: true } })
  })

  it('reads every playlist page and retains the numeric ID and song type needed for writing', async () => {
    mock.fetchQq
      .mockResolvedValueOnce(ok(block({ code: 0, total_song_num: 3, hasmore: 1,
        songlist: [{ id: 11, type: 1, mid: 'A', name: 'One', singer: [{ id: 3, name: 'Singer' }], album: { id: 4, name: 'Album' }, interval: 180 },
          { id: 12, type: 0, mid: 'B', name: 'Two', singer: [], album: {}, interval: 190 }] })))
      .mockResolvedValueOnce(ok(block({ code: 0, total_song_num: 3, hasmore: 0,
        songlist: [{ id: 13, type: 2, mid: 'C', name: 'Three', singer: [], album: {}, interval: 200 }] })))

    const songs = await getQqPlaylistSongs(3602407677)
    expect(songs.map((s) => [s.id, s.songType, s.platform])).toEqual([
      [11, 1, 'qq'], [12, 0, 'qq'], [13, 2, 'qq'],
    ])
    expect(mock.fetchQq).toHaveBeenCalledTimes(2)
  })

  it('rejects a failed business block even if its inner retCode claims success', async () => {
    mock.fetchQq.mockResolvedValue(ok(block({ retCode: 0, result: { tid: 9 } }, 80105)))
    await expect(createQqPlaylist('TuneNest 测试')).rejects.toThrow('80105')
    expect(mock.fetchQq).toHaveBeenCalledTimes(1)
  })
})
