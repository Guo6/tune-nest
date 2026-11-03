import { useState, useEffect } from 'react'
import { LoginCheck } from './pages/LoginCheck'
import { PlaylistSelect } from './pages/PlaylistSelect'
import { DimensionConfig } from './pages/DimensionConfig'
import { ClassifyProgress } from './pages/ClassifyProgress'
import { ResultPreview } from './pages/ResultPreview'
import { CreateConfirm } from './pages/CreateConfirm'
import { TopRecord } from './pages/TopRecord'
import { Home } from './pages/Home'
import type { Playlist, Song, DimensionSelection, ClassifyResult, CategoryGroup } from '@/types'
import { DIMENSION_META } from '@/types'
import { getDesktop } from '@/platform/desktop'
import { OptionsApp } from '@/options/OptionsApp'
import type { MusicPlatform } from '@/adapters'

const CURRENT_VERSION = getDesktop()?.version || (() => {
  try { return chrome.runtime.getManifest().version } catch { return '0.1.0' }
})()
const GITHUB_REPO = 'fy-xbot/tune-nest'

export type Step = 'login' | 'home' | 'select' | 'dimensions' | 'progress' | 'result' | 'create' | 'top-record'

export interface AppState {
  uid: number | null
  selectedPlaylists: Playlist[]
  songs: Song[]
  dimensionSelection: DimensionSelection
  results: ClassifyResult[]
  grouped: CategoryGroup[]
}

export function PanelApp() {
  const desktop = getDesktop()
  const [open, setOpen] = useState(false)
  const [showLoginHint, setShowLoginHint] = useState(true)
  const [step, setStep] = useState<Step>('login')
  const [platform, setPlatform] = useState<MusicPlatform>(() => getDesktop() && localStorage.getItem('tn_platform') === 'qq' ? 'qq' : 'netease')
  const [prevStep, setPrevStep] = useState<Step>('login')
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<AppState>({
    uid: null,
    selectedPlaylists: [],
    songs: [],
    dimensionSelection: { mood: [...DIMENSION_META.mood.categories] },
    results: [],
    grouped: [],
  })

  useEffect(() => { if (!desktop) checkUpdate() }, [])

  const checkUpdate = async () => {
    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`)
      if (!res.ok) return
      const data = await res.json()
      const tag = (data.tag_name || '').replace(/^v/, '')
      if (tag && tag !== CURRENT_VERSION) {
        setLatestVersion(tag)
      }
    } catch { /* ignore */ }
  }

  const updateState = (partial: Partial<AppState>) => {
    setState((prev) => ({ ...prev, ...partial }))
  }

  const changePlatform = (next: MusicPlatform) => {
    if (next === platform) return
    setPlatform(next)
    localStorage.setItem('tn_platform', next)
    updateState({ uid: null, selectedPlaylists: [], songs: [], results: [], grouped: [] })
    setSettingsOpen(false)
    setStep('login')
  }

  const renderStep = () => {
    switch (step) {
      case 'login':
        return (
          <LoginCheck
            key={platform}
            platform={platform}
            onPlatformChange={changePlatform}
            onSuccess={(uid) => {
              updateState({ uid })
              setStep('home')
            }}
          />
        )
      case 'home':
        return (
          <Home
            platform={platform}
            onNavigate={(target) => {
              setPrevStep('home')
              setStep(target as Step)
            }}
          />
        )
      case 'select':
        return (
          <PlaylistSelect
            platform={platform}
            uid={state.uid!}
            onConfirm={(playlists, songs) => {
              updateState({ selectedPlaylists: playlists, songs })
              setStep('dimensions')
            }}
          />
        )
      case 'dimensions':
        return (
          <DimensionConfig
            selection={state.dimensionSelection}
            onChange={(sel) => updateState({ dimensionSelection: sel })}
            onConfirm={() => setStep('progress')}
            onBack={() => setStep('select')}
          />
        )
      case 'progress':
        return (
          <ClassifyProgress
            songs={state.songs}
            dimensionSelection={state.dimensionSelection}
            onComplete={(results, grouped) => {
              updateState({ results, grouped })
              setStep('result')
            }}
          />
        )
      case 'result':
        return (
          <ResultPreview
            grouped={state.grouped}
            onConfirm={() => setStep('create')}
            onBack={() => setStep('dimensions')}
            onReassign={(songId, dimension, newCategory) => {
              const newGrouped = state.grouped.map((g) => {
                if (g.dimension !== dimension) return g
                return {
                  ...g,
                  songs: g.songs.filter((s) => s.songId !== songId),
                }
              }).filter((g) => g.songs.length > 0)

              const song = state.grouped
                .flatMap((g) => g.songs)
                .find((s) => s.songId === songId)

              if (song) {
                const updatedSong = { ...song, [dimension]: newCategory }
                const existing = newGrouped.find(
                  (g) => g.dimension === dimension && g.category === newCategory
                )
                if (existing) {
                  existing.songs.push(updatedSong)
                } else {
                  newGrouped.push({ dimension, category: newCategory, songs: [updatedSong] })
                }
              }

              updateState({ grouped: newGrouped })
            }}
          />
        )
      case 'create':
        return (
          <CreateConfirm
            platform={platform}
            uid={state.uid!}
            songs={state.songs}
            grouped={state.grouped}
            onDone={() => {
              setStep('login')
              setOpen(false)
            }}
            onBusyChange={setBusy}
          />
        )
      case 'top-record':
        return (
          <TopRecord
            uid={state.uid!}
            onBack={() => setStep(prevStep)}
          />
        )
    }
  }

  if (desktop) {
    const navigation: Array<{ key: string; title: string; icon: string; step?: Step }> = [
      { key: 'home', title: '首页', icon: '⌂', step: 'home' },
      { key: 'classify', title: '智能歌单分类', icon: '✦', step: 'select' },
      ...(platform === 'netease' ? [{ key: 'top', title: '听歌排行 Top100', icon: '♜', step: 'top-record' as Step }] : []),
    ]
    const classifySteps: Step[] = ['select', 'dimensions', 'progress', 'result', 'create']
    const isNavigationItemActive = (key: string, itemStep?: Step) => {
      if (settingsOpen) return false
      if (key === 'home') return step === 'login' || step === 'home'
      if (key === 'classify') return classifySteps.includes(step)
      return itemStep === step
    }
    return (
      <div className="desktop-shell">
        <aside className="desktop-sidebar">
          <div className="desktop-brand"><span className="desktop-brand-icon">♫</span><span>TuneNest</span><small>v{CURRENT_VERSION}</small></div>
          <nav className="desktop-nav">
            {navigation.map((item) => (
              <button key={item.key} className={`desktop-nav-item ${isNavigationItemActive(item.key, item.step) ? 'active' : ''}`} disabled={busy} onClick={() => { setSettingsOpen(false); setStep(state.uid ? item.step! : 'login') }}>
                <span>{item.icon}</span>{item.title}
              </button>
            ))}
          </nav>
          <div className="desktop-sidebar-bottom">
            <div className="flex gap-2 px-3 mb-3">
              <button className={`tn-btn text-xs flex-1 ${platform === 'netease' ? 'tn-btn-primary' : 'tn-btn-secondary'}`} disabled={busy} onClick={() => changePlatform('netease')}>网易云</button>
              <button className={`tn-btn text-xs flex-1 ${platform === 'qq' ? 'tn-btn-primary' : 'tn-btn-secondary'}`} disabled={busy} onClick={() => changePlatform('qq')}>QQ 音乐</button>
            </div>
            <button className={`desktop-nav-item ${settingsOpen ? 'active' : ''}`} disabled={busy} onClick={() => setSettingsOpen(true)}><span>⚙</span>设置</button>
            <p>{platform === 'qq' ? 'QQ 音乐' : '网易云音乐'}歌单整理工具</p>
          </div>
        </aside>
        <main className="desktop-main">
          <header className="desktop-topbar"><div><div className="desktop-eyebrow">TUNENEST MUSIC ORGANIZER</div><h1>{settingsOpen ? '设置' : step === 'login' ? `连接${platform === 'qq' ? 'QQ 音乐' : '网易云音乐'}` : step === 'home' ? '欢迎回来' : step === 'select' ? '选择歌单' : step === 'dimensions' ? '选择分类维度' : step === 'progress' ? '整理歌曲' : step === 'result' ? '分类结果' : step === 'create' ? '创建歌单' : '听歌排行'}</h1></div><div className="desktop-topbar-right"><span className="desktop-version-badge">版本 v{CURRENT_VERSION}</span><div className="desktop-account">{state.uid ? <><span className="desktop-online-dot"/>已登录 · {platform === 'qq' ? 'QQ 音乐' : '网易云'}</> : <><span className="desktop-offline-dot"/>未连接</>}</div></div></header>
          <section className="desktop-content">
            {latestVersion && <div className="desktop-update">发现新版本 v{latestVersion}　<a href={`https://github.com/${GITHUB_REPO}/releases/latest`} target="_blank" rel="noreferrer">前往更新</a></div>}
            {settingsOpen ? <OptionsApp embedded /> : renderStep()}
          </section>
        </main>
      </div>
    )
  }

  return (
    <>
      {/* 悬浮按钮 */}
      <div className="tn-fab-wrap">
        {showLoginHint && step === 'login' && !open && (
          <div className="tn-login-hint">
            未登录？点击这里开始检测
          </div>
        )}
        <button
          className="tn-fab"
          onClick={() => {
            setOpen(!open)
            setShowLoginHint(false)
          }}
          title="TuneNest 智能分类"
        >
          <img src={chrome.runtime.getURL('public/icons/icon128.png')} alt="TuneNest" className="w-7 h-7 rounded-full" />
        </button>
      </div>

      {/* 侧边面板 */}
      <div className={`tn-panel ${open ? 'open' : 'closed'}`}>
        <div className="tn-panel-header">
          <div className="flex items-center gap-2">
            <h2>TuneNest</h2>
            <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">v{CURRENT_VERSION}</span>
          </div>
          <div className="flex items-center gap-2">
            {state.uid && step !== 'home' && step !== 'login' && (
              <button
                className="text-gray-400 hover:text-gray-600 text-sm cursor-pointer transition-colors"
                onClick={() => setStep('home')}
                title="返回主页"
              >
                ⊞
              </button>
            )}
            <button
              className="text-gray-400 hover:text-gray-600 text-xl cursor-pointer"
              onClick={() => setOpen(false)}
            >
              ✕
            </button>
          </div>
        </div>
        {latestVersion && (
          <div className="flex items-center justify-between px-4 py-2 bg-amber-50 border-b border-amber-100 text-xs">
            <span className="text-amber-700">🎉 新版本 v{latestVersion} 可用</span>
            <a
              href={`https://github.com/${GITHUB_REPO}/releases/latest`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary font-semibold hover:underline"
            >
              前往更新
            </a>
          </div>
        )}
        <div className="tn-panel-body">
          {renderStep()}
        </div>
      </div>
    </>
  )
}
