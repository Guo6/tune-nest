import { useEffect, useState } from 'react'
import type { Settings } from '@/types'
import { DEFAULT_SETTINGS } from '@/types'
import { getDesktop } from '@/platform/desktop'
import { loadSettings, saveSettings, requestDeepseek } from '@/platform/settings'

export function OptionsApp({ embedded = false }: { embedded?: boolean }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadSettings().then(setSettings).catch((err) => setError(err.message)).finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await saveSettings(settings)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败') }
    finally { setSaving(false) }
  }

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      await requestDeepseek({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5,
      }, settings.deepseekApiKey)
      setTestResult('✓ 连接成功')
    } catch (err) {
      setTestResult(`✗ 网络错误: ${err instanceof Error ? err.message : '未知'}`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className={embedded ? 'max-w-xl' : 'max-w-lg mx-auto py-10 px-6'}>
      {!embedded && <h1 className="text-2xl font-bold text-gray-800 mb-6">TuneNest 设置</h1>}
      {error && <p role="alert" className="mb-4 text-sm text-red-500">{error}</p>}
      {loading && <p className="text-sm text-gray-500 mb-4">读取设置中...</p>}

      <fieldset disabled={loading || saving} className="space-y-6">
        {/* DeepSeek API Key */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            DeepSeek API Key
          </label>
          <input
            type="password"
            value={settings.deepseekApiKey}
            onChange={(e) => setSettings({ ...settings, deepseekApiKey: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            placeholder="sk-..."
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              className="text-sm text-primary hover:underline"
              onClick={testConnection}
              disabled={testing || !settings.deepseekApiKey}
            >
              {testing ? '测试中...' : '测试连通性'}
            </button>
            {testResult && (
              <span className={`text-xs ${testResult.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>
                {testResult}
              </span>
            )}
          </div>

          <details className="mt-3 text-xs text-gray-500 bg-gray-50 rounded-lg p-3 border border-gray-100">
            <summary className="cursor-pointer font-medium text-gray-600 select-none">
              如何获取 DeepSeek API Key？
            </summary>
            <ol className="mt-2 space-y-1.5 list-decimal list-inside leading-relaxed">
              <li>
                打开{' '}
                <a href="https://platform.deepseek.com/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  platform.deepseek.com
                </a>
                {' '}并注册/登录
              </li>
              <li>进入控制台，点击左侧「API Keys」菜单</li>
              <li>点击「创建 API Key」，复制生成的密钥（以 sk- 开头）</li>
              <li>回到此页面粘贴到上方输入框，点击保存</li>
            </ol>
            <p className="mt-2 text-gray-400">
              AI 分类的费用和额度以 DeepSeek 平台显示为准。
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
          {saving ? '保存中...' : '保存设置'}
        </button>
        {saved && <span className="text-sm text-green-600 ml-3">已保存</span>}
      </fieldset>
    </div>
  )
}
