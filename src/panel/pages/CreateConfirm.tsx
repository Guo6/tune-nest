import { useState, useEffect } from 'react'
import type { CategoryGroup, Song } from '@/types'
import { getMusicAdapter, type MusicPlatform } from '@/adapters'

interface Props {
  platform: MusicPlatform
  uid: number
  songs: Song[]
  grouped: CategoryGroup[]
  onDone: () => void
  onBusyChange?: (busy: boolean) => void
}

const DIMENSION_LABELS: Record<string, string> = {
  mood: '情绪',
  language: '语种',
  region: '地区',
  era: '年代',
  genre: '风格',
}

type TaskStatus = 'pending' | 'creating' | 'done' | 'error' | 'skipped'
type ConflictAction = 'replace' | 'append' | 'skip' | null

interface PlaylistTask {
  name: string
  trackIds: number[]
  status: TaskStatus
  error?: string
  existingId?: number
  existingCount?: number
  createdId?: number
  conflictAction?: ConflictAction
}

export function CreateConfirm({ platform, uid, songs, grouped, onDone, onBusyChange }: Props) {
  const adapter = getMusicAdapter(platform)
  const songsById = new Map(songs.map((song) => [song.id, song]))
  const [tasks, setTasks] = useState<PlaylistTask[]>(() =>
    grouped
      .filter((g) => g.category !== '未分类' && g.songs.length > 0)
      .map((g) => ({
        name: `[TuneNest] ${g.category}-${DIMENSION_LABELS[g.dimension] || g.dimension}歌单`,
        trackIds: g.songs.map((s) => s.songId),
        status: 'pending' as TaskStatus,
      }))
  )
  const [running, setRunning] = useState(false)
  const [checking, setChecking] = useState(true)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [conflictIdx, setConflictIdx] = useState<number | null>(null)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)

  useEffect(() => {
    onBusyChange?.(running)
    return () => onBusyChange?.(false)
  }, [running, onBusyChange])

  const renameTask = (idx: number, newName: string) => {
    const updated = [...tasks]
    updated[idx].name = newName.trim() || updated[idx].name
    updated[idx].existingId = undefined
    updated[idx].existingCount = undefined
    updated[idx].conflictAction = undefined
    if (updated[idx].status === 'skipped') updated[idx].status = 'pending'
    setTasks(updated)
    setEditingIdx(null)
    void checkExisting(updated)
  }

  useEffect(() => {
    checkExisting()
  }, [])

  const checkExisting = async (source: PlaylistTask[] = tasks) => {
    setChecking(true)
    setLookupError(null)
    const updated = [...source]
    try {
      const playlists = (await adapter.getUserPlaylists(uid)).filter((playlist) =>
        platform === 'qq' ? !playlist.subscribed : playlist.creator.userId === uid)
      for (const task of updated) {
        const matches = playlists.filter((playlist) => playlist.name === task.name)
        if (matches.length > 1) throw new Error(`存在多个同名歌单“${task.name}”，请先改名以免写错`)
        task.existingId = matches[0]?.id
        task.existingCount = matches[0]?.trackCount
      }
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : '检查同名歌单失败')
    }
    setTasks(updated)
    setChecking(false)
  }

  const hasConflicts = tasks.some((t) => t.existingId && !t.conflictAction)

  const handleConflictChoice = (idx: number, action: ConflictAction) => {
    const updated = [...tasks]
    updated[idx].conflictAction = action
    if (action === 'skip') updated[idx].status = 'skipped'
    setTasks(updated)
    setConflictIdx(null)
  }

  const setAllConflicts = (action: ConflictAction) => {
    const updated = tasks.map((t) => {
      if (t.existingId && !t.conflictAction) {
        return { ...t, conflictAction: action, status: action === 'skip' ? 'skipped' as TaskStatus : t.status }
      }
      return t
    })
    setTasks(updated)
  }

  const runCreate = async () => {
    if (lookupError) return
    setRunning(true)
    const updated = [...tasks]

    for (let i = 0; i < updated.length; i++) {
      if (updated[i].status === 'skipped' || updated[i].status === 'done') continue

      updated[i].status = 'creating'
      updated[i].error = undefined
      setTasks([...updated])

      try {
        let pid: number

        const tracks = updated[i].trackIds.map((id) => songsById.get(id))
        if (tracks.some((song) => !song)) throw new Error('分类结果中有歌曲信息丢失，已停止写入')
        const targetSongs = tracks as Song[]
        let alreadyAdded = false

        if (updated[i].createdId) {
          pid = updated[i].createdId!
        } else if (updated[i].existingId && updated[i].conflictAction === 'replace') {
          pid = updated[i].existingId!
          if (!adapter.replacePlaylist) throw new Error(`${adapter.name}暂不支持安全替换，请选择追加或跳过`)
          await adapter.replacePlaylist(pid, targetSongs)
          alreadyAdded = true
        } else if (updated[i].existingId && updated[i].conflictAction === 'append') {
          pid = updated[i].existingId!
        } else {
          const justFound = await adapter.findPlaylistByName(uid, updated[i].name)
          if (justFound) {
            updated[i].existingId = justFound.id
            updated[i].existingCount = justFound.trackCount
            updated[i].conflictAction = null
            throw new Error('同名歌单已出现，请先选择追加或跳过，避免重复创建')
          }
          // 创建不是幂等操作，403 或网络结果不明时不要自动连续重试。
          pid = await adapter.createPlaylist(updated[i].name)
          updated[i].createdId = pid
        }

        if (!alreadyAdded) await adapter.addSongsToPlaylist(pid, targetSongs)

        updated[i].status = 'done'
      } catch (err) {
        updated[i].status = 'error'
        updated[i].error = err instanceof Error ? err.message : '未知错误'
      }

      setTasks([...updated])
      if (i < updated.length - 1) {
        await new Promise((r) => setTimeout(r, 2000))
      }
    }

    setRunning(false)
  }

  const activeTasks = tasks.filter((t) => t.status !== 'skipped')
  const doneCount = tasks.filter((t) => t.status === 'done').length
  const allDone = activeTasks.length > 0 && activeTasks.every((t) => t.status === 'done')

  if (checking) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-gray-500 text-sm">检查已有歌单...</p>
      </div>
    )
  }

  return (
    <div>
      {lookupError && <div className="mb-3 text-sm text-red-500">检查同名歌单失败：{lookupError} <button className="underline" onClick={() => { void checkExisting() }}>重试</button></div>}
      <p className="text-sm text-gray-500 mb-2">
        将创建 {activeTasks.length} 个歌单：
      </p>

      {hasConflicts && !running && (
        <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-xs text-amber-700 mb-2">
            检测到 {tasks.filter((t) => t.existingId && !t.conflictAction).length} 个同名歌单已存在，请选择处理方式：
          </p>
          <div className="flex gap-2">
            <button className="tn-btn text-xs bg-blue-500 text-white hover:bg-blue-600" onClick={() => setAllConflicts('append')}>
              全部追加
            </button>
            {adapter.replacePlaylist && <button className="tn-btn text-xs bg-orange-500 text-white hover:bg-orange-600" onClick={() => setAllConflicts('replace')}>
              全部替换
            </button>}
            <button className="tn-btn text-xs bg-gray-400 text-white hover:bg-gray-500" onClick={() => setAllConflicts('skip')}>
              全部跳过
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2 max-h-[340px] overflow-y-auto">
        {tasks.map((task, idx) => (
          <div
            key={idx}
            className={`flex items-center gap-3 p-3 rounded-lg border ${
              task.status === 'done'
                ? 'border-green-200 bg-green-50'
                : task.status === 'error'
                ? 'border-red-200 bg-red-50'
                : task.status === 'creating'
                ? 'border-primary/30 bg-red-50/30'
                : task.status === 'skipped'
                ? 'border-gray-200 bg-gray-50 opacity-50'
                : 'border-gray-200'
            }`}
          >
            <div className="flex-shrink-0 w-5 text-center">
              {task.status === 'done' && <span className="text-green-500">✓</span>}
              {task.status === 'error' && <span className="text-red-500">✗</span>}
              {task.status === 'skipped' && <span className="text-gray-400">—</span>}
              {task.status === 'creating' && (
                <span className="inline-block w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              )}
              {task.status === 'pending' && <span className="text-gray-300">○</span>}
            </div>
            <div className="flex-1 min-w-0">
              {editingIdx === idx ? (
                <input
                  autoFocus
                  className="text-sm text-gray-800 w-full px-1.5 py-0.5 border border-primary/40 rounded outline-none"
                  defaultValue={task.name}
                  onBlur={(e) => renameTask(idx, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') renameTask(idx, (e.target as HTMLInputElement).value)
                    if (e.key === 'Escape') setEditingIdx(null)
                  }}
                />
              ) : (
                <p
                  className={`text-sm text-gray-800 truncate ${!running && task.status === 'pending' ? 'cursor-pointer hover:text-primary' : ''}`}
                  onClick={() => !running && task.status === 'pending' && setEditingIdx(idx)}
                  title={!running && task.status === 'pending' ? '点击修改歌单名' : undefined}
                >
                  {task.name}
                  {!running && task.status === 'pending' && (
                    <span className="text-gray-300 text-xs ml-1">✎</span>
                  )}
                </p>
              )}
              <p className="text-xs text-gray-400">
                {task.trackIds.length} 首
                {task.existingId && !task.conflictAction && (
                  <span className="text-amber-600 ml-1">（已存在 {task.existingCount} 首）</span>
                )}
                {task.conflictAction === 'append' && (
                  <span className="text-blue-500 ml-1">→ 追加</span>
                )}
                {task.conflictAction === 'replace' && (
                  <span className="text-orange-500 ml-1">→ 替换</span>
                )}
                {task.conflictAction === 'skip' && (
                  <span className="text-gray-400 ml-1">→ 跳过</span>
                )}
              </p>
              {task.error && (
                <p className="text-xs text-red-500 mt-0.5">{task.error}</p>
              )}
              {task.existingId && !task.conflictAction && !running && (
                <div className="flex gap-1 mt-1">
                  <button className="text-xs text-blue-500 hover:underline" onClick={() => handleConflictChoice(idx, 'append')}>追加</button>
                  <span className="text-xs text-gray-300">|</span>
                  {adapter.replacePlaylist && <><button className="text-xs text-orange-500 hover:underline" onClick={() => handleConflictChoice(idx, 'replace')}>替换</button>
                  <span className="text-xs text-gray-300">|</span></>}
                  <button className="text-xs text-gray-400 hover:underline" onClick={() => handleConflictChoice(idx, 'skip')}>跳过</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 冲突弹窗 */}
      {conflictIdx !== null && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[999999]">
          <div className="bg-white rounded-xl p-5 w-72 shadow-xl">
            <p className="text-sm font-medium text-gray-800 mb-3">
              「{tasks[conflictIdx].name}」已存在
            </p>
            <p className="text-xs text-gray-500 mb-4">
              已有 {tasks[conflictIdx].existingCount} 首歌，请选择操作：
            </p>
            <div className="space-y-2">
              <button className="tn-btn tn-btn-primary w-full" onClick={() => handleConflictChoice(conflictIdx, 'append')}>
                追加歌曲
              </button>
              {adapter.replacePlaylist && <button className="tn-btn w-full bg-orange-500 text-white hover:bg-orange-600" onClick={() => handleConflictChoice(conflictIdx, 'replace')}>
                清空后替换
              </button>}
              <button className="tn-btn tn-btn-secondary w-full" onClick={() => handleConflictChoice(conflictIdx, 'skip')}>
                跳过
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4">
        {!running && !allDone && (
          <button
            className="tn-btn tn-btn-primary w-full disabled:opacity-50"
            onClick={runCreate}
            disabled={hasConflicts || !!lookupError}
          >
            {hasConflicts ? '请先处理同名歌单' : `${tasks.some((t) => t.status === 'error') ? '重试未完成' : '开始创建'} (${activeTasks.length - doneCount} 个歌单)`}
          </button>
        )}
        {running && (
          <p className="text-sm text-center text-gray-500">
            正在创建... ({doneCount}/{activeTasks.length})
          </p>
        )}
        {allDone && (
          <div className="text-center">
            <p className="text-green-600 font-medium mb-3">全部创建完成！</p>
            <button className="tn-btn tn-btn-primary" onClick={onDone}>
              完成
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
