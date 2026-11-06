import { useEffect, useState } from 'react'
import type { AIProvider, Settings } from '@/types'
import { DEFAULT_SETTINGS } from '@/types'
import { getDesktop, unwrapDesktopResult } from '@/platform/desktop'
import { loadSettings, saveSettings, requestAI } from '@/platform/settings'
import { AI_PROVIDERS, hasAIKey, readAIContent } from '@/platform/ai'

export function OptionsApp({ embedded = false, onSaved, saveLabel = '保存设置' }: { embedded?: boolean; onSaved?: (settings: Settings) => void; saveLabel?: string }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const provider = AI_PROVIDERS[settings.aiProvider]
  const pendingKey = settings.aiKeys[settings.aiProvider]

  useEffect(() => {
    loadSettings().then(setSettings).catch((err) => setError(err.message)).finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await saveSettings(settings)
      const loaded = await loadSettings()
      setSettings(loaded)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved?.(loaded)
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败') }
    finally { setSaving(false) }
  }

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const data = await requestAI({
          messages: [{ role: 'user', content: 'Reply with OK only.' }],
          max_tokens: 256,
      }, settings)
      const content = readAIContent(data)
      if (!/^OK[.!。！]?$/i.test(content)) throw new Error('模型已返回内容，但未通过指令校验')
      setTestResult(`✓ ${provider.name} / ${provider.model} 实际调用成功`)
    } catch (err) {
      setTestResult(`✗ ${err instanceof Error ? err.message : '调用失败'}`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className={embedded ? 'max-w-xl' : 'max-w-lg mx-auto py-10 px-6'}>
      {!embedded && <h1 className="text-2xl font-bold text-gray-800 mb-6">TuneNest 设置</h1>}
      {error && <p role="alert" className="mb-4 text-sm text-red-500">{error}</p>}
      {loading && <p className="text-sm text-gray-500 mb-4">读取设置中...</p>}

      <fieldset disabled={loading || saving || testing} className="space-y-6">
        <div>
          <label htmlFor="ai-provider" className="block text-sm font-medium text-gray-700 mb-1">AI 渠道</label>
          <select id="ai-provider" value={settings.aiProvider}
            onChange={(e) => { setSettings({ ...settings, aiProvider: e.target.value as AIProvider }); setTestResult(null); setSaved(false) }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {Object.entries(AI_PROVIDERS).map(([id, config]) => <option key={id} value={id}>{config.name}{id === 'xbot' ? '（默认）' : ''}</option>)}
          </select>
          <p className="mt-2 text-xs text-gray-500">模型：{provider.model}</p>
        </div>
        <div>
          <label htmlFor="ai-key" className="block text-sm font-medium text-gray-700 mb-1">
            {provider.name} API Key
          </label>
          <input
            type="password"
            id="ai-key"
            autoComplete="off"
            value={pendingKey ?? ''}
            onChange={(e) => { setSettings({ ...settings, aiKeys: { ...settings.aiKeys, [settings.aiProvider]: e.target.value } }); setTestResult(null); setSaved(false) }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            placeholder={settings.aiKeyConfigured[settings.aiProvider] ? '已保存密钥；留空保持原密钥，输入新密钥可替换' : '粘贴当前渠道的 API Key'}
          />
          {pendingKey === '' && settings.aiKeyConfigured[settings.aiProvider] && <p className="mt-1 text-xs text-red-500">保存后将清除该渠道密钥。</p>}
          <div className="flex items-center gap-2 mt-2">
            <button
              className="text-sm text-primary hover:underline"
              onClick={testConnection}
              disabled={testing || !hasAIKey(settings)}
            >
              {testing ? '测试中...' : '测试实际调用'}
            </button>
            {testResult && (
              <span className={`text-xs ${testResult.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>
                {testResult}
              </span>
            )}
          </div>
          {settings.aiKeyConfigured[settings.aiProvider] && <button type="button" className="text-xs text-gray-500 mt-2 hover:text-red-500" onClick={() => {
            setSettings({ ...settings, aiKeys: { ...settings.aiKeys, [settings.aiProvider]: '' } }); setTestResult(null)
          }}>清除该渠道密钥（保存后生效）</button>}

          <details className="mt-3 text-xs text-gray-500 bg-gray-50 rounded-lg p-3 border border-gray-100">
            <summary className="cursor-pointer font-medium text-gray-600 select-none">
              如何获取 {provider.name} API Key？
            </summary>
            <ol className="mt-2 space-y-1.5 list-decimal list-inside leading-relaxed">
              <li>
                打开{' '}
                <a href={provider.keyUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" onClick={(event) => {
                  const desktop = getDesktop()
                  if (!desktop) return
                  event.preventDefault()
                  void desktop.openAIConsole(settings.aiProvider).then(unwrapDesktopResult).catch(() => setError('无法打开浏览器，请手动访问渠道控制台'))
                }}>
                  {provider.name} 控制台
                </a>
                {' '}并注册/登录
              </li>
              <li>{settings.aiProvider === 'xbot' ? '登录后点击网站顶部「TuneNest」菜单，再点击「创建 / 获取 API Key」。' : '进入 API Key 管理页面，创建标准 API 调用密钥。'}</li>
              <li>复制密钥，回到 TuneNest 设置，选择同一渠道，粘贴并保存。</li>
              <li>点击「测试实际调用」，确认模型能够正常返回内容。</li>
            </ol>
            <p className="mt-2 text-gray-400">
              AI 分类的费用和额度以所选渠道显示为准。三个渠道的密钥分别保存。
              不配置 API Key 也可以使用规则分类。
            </p>
          </details>
        </div>

        {/* 启用 AI */}
        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.enableAI}
              onChange={(e) => setSettings({ ...settings, enableAI: e.target.checked })}
              className="w-4 h-4 accent-primary"
            />
            <span className="text-sm text-gray-700">启用 AI 分类（规则无法判定时使用）</span>
          </label>
        </div>

        {/* 批量大小 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            AI 批量大小（每次发送歌曲数）
          </label>
          <input
            type="number"
            min={5}
            max={50}
            value={settings.batchSize}
            onChange={(e) => setSettings({ ...settings, batchSize: Number(e.target.value) })}
            className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        {/* 请求延迟 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            请求间隔 (ms)
          </label>
          <input
            type="number"
            min={200}
            max={3000}
            step={100}
            value={settings.requestDelay}
            onChange={(e) => setSettings({ ...settings, requestDelay: Number(e.target.value) })}
            className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <p className="text-xs text-gray-400 mt-1">避免请求过快被网易云限流</p>
        </div>

        {/* 保存 */}
        {getDesktop() && <p className="text-xs text-gray-400">API Key 使用系统加密后保存在本机。</p>}
        <button className="tn-btn tn-btn-primary" onClick={save}>
          {saving ? '保存中...' : saveLabel}
        </button>
        {saved && <span className="text-sm text-green-600 ml-3">已保存</span>}
      </fieldset>
    </div>
  )
}
