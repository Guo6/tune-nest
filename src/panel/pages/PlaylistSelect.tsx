import { useEffect, useState } from 'react'
import type { Playlist, Song } from '@/types'
import { getMusicAdapter, type MusicPlatform } from '@/adapters'

interface Props {
  platform: MusicPlatform
  uid: number
  onConfirm: (playlists: Playlist[], songs: Song[]) => void
}

export function PlaylistSelect({ platform, uid, onConfirm }: Props) {
  const adapter = getMusicAdapter(platform)
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadPlaylists()
  }, [uid, platform])

  const loadPlaylists = async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await adapter.getUserPlaylists(uid)
      setPlaylists(platform === 'qq' ? list : list.filter((p) => p.creator.userId === uid))
      setSelected(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取歌单失败')
    } finally {
      setLoading(false)
    }
  }

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleConfirm = async () => {
    setFetching(true)
    setError(null)
    const selectedPlaylists = playlists.filter((p) => selected.has(p.id))
    const allSongs: Song[] = []

    try {
      for (const pl of selectedPlaylists) {
        const songs = await adapter.getPlaylistSongs(pl.id)
        allSongs.push(...songs)
      }
      const unique = Array.from(new Map(allSongs.map((s) => [s.id, s])).values())
      onConfirm(selectedPlaylists, unique)
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取歌曲详情失败')
    } finally {
      setFetching(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center py-12">
        <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-gray-500 text-sm">加载歌单中...</p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        选择要分类的歌单（已选 {selected.size} 个）
      </p>

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
      {error && <button className="tn-btn tn-btn-secondary mb-3" onClick={loadPlaylists}>重新加载歌单</button>}
      {!error && playlists.length === 0 && <p className="text-sm text-gray-400 py-8">当前账号还没有可整理的歌单。</p>}

      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {playlists.map((pl) => (
          <label key={pl.id} className="tn-checkbox-item">
            <input
              type="checkbox"
              checked={selected.has(pl.id)}
              onChange={() => toggleSelect(pl.id)}
              className="w-4 h-4 accent-primary"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{pl.name}</p>
              <p className="text-xs text-gray-400">{pl.trackCount} 首{pl.subscribed ? ' · 收藏' : ''}</p>
            </div>
          </label>
        ))}
      </div>

      <button
        className="tn-btn tn-btn-primary w-full mt-4"
        disabled={selected.size === 0 || fetching}
        onClick={handleConfirm}
      >
        {fetching ? '获取歌曲中...' : `确认 (${selected.size} 个歌单)`}
      </button>
    </div>
  )
}
