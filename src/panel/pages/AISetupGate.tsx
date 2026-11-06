import { useEffect, useRef, useState } from 'react'
import type { Settings } from '@/types'
import { AI_PROVIDERS, hasAIKey } from '@/platform/ai'
import { loadSettings } from '@/platform/settings'
import { OptionsApp } from '@/options/OptionsApp'

interface Props {
  onContinue: (rulesOnly: boolean) => void
  onBack: () => void
}

export function AISetupGate({ onContinue, onBack }: Props) {
  const [phase, setPhase] = useState<'checking' | 'prompt' | 'settings'>('checking')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const active = useRef(true)

  const check = async () => {
    setPhase('checking')
    setError(null)
    try {
      const loaded = await loadSettings()
      if (!active.current) return
      setSettings(loaded)
      if (loaded.enableAI && hasAIKey(loaded)) onContinue(false)
      else setPhase('prompt')
    } catch {
      if (!active.current) return
      setError('暂时无法读取 AI 设置。可以重试，或先使用规则分类。')
      setPhase('prompt')
    }
  }

  useEffect(() => {
    active.current = true
    void check()
    return () => { active.current = false }
  }, [])

  const onSaved = (loaded: Settings) => {
    if (!active.current) return
    setSettings(loaded)
    if (loaded.enableAI && hasAIKey(loaded)) onContinue(false)
    else setError('设置已保存。请填写当前渠道的 API Key 并启用 AI，或返回选择规则分类。')
  }

  if (phase === 'checking') return <p role="status" className="py-12 text-center text-sm text-gray-500">正在检查 AI 渠道配置…</p>

  if (phase === 'settings') return (
    <div>
      <button className="mb-4 text-sm text-gray-500 hover:text-primary" onClick={() => { setError(null); setPhase('prompt') }}>← 返回分类准备</button>
      <h2 className="mb-2 text-lg font-semibold text-gray-800">配置 AI 渠道</h2>
      <p className="mb-5 text-sm text-gray-500">填写密钥并启用 AI，保存后继续刚才的分类流程。</p>
      {error && <p role="alert" className="mb-4 text-sm text-red-500">{error}</p>}
      <OptionsApp embedded onSaved={onSaved} saveLabel="保存并继续分类" />
    </div>
  )

  return (
    <div className="mx-auto max-w-xl py-6">
      <div className="mb-4 text-3xl" aria-hidden="true">✦</div>
      <h2 className="mb-3 text-xl font-semibold text-gray-800">建议先配置 AI 渠道</h2>
      <p className="text-sm leading-6 text-gray-600">AI 可以辅助判断歌曲的情绪、风格等信息，补充规则难以判断的分类，让整理效果更好。</p>
      {settings && <p className="mt-3 text-sm text-gray-500">当前渠道：{AI_PROVIDERS[settings.aiProvider].name} · {hasAIKey(settings) ? '已配置密钥，尚未启用 AI' : '尚未配置 API Key'}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}
      <div className="mt-6 flex flex-wrap gap-3">
        <button className="tn-btn tn-btn-primary" onClick={() => { setError(null); setPhase('settings') }}>去配置 AI 渠道</button>
        <button className="tn-btn tn-btn-secondary" onClick={() => onContinue(true)}>暂不配置，继续分类</button>
      </div>
      <p className="mt-3 text-xs leading-5 text-gray-400">暂不配置时，本次仅使用规则分类。之后仍可在设置中启用 AI；此检查不会调用模型或消耗额度。</p>
      <div className="mt-6 flex gap-4 text-sm text-gray-500">
        <button onClick={onBack} className="hover:text-primary">← 返回</button>
        {error && <button onClick={() => void check()} className="hover:text-primary">重新检查</button>}
      </div>
    </div>
  )
}
