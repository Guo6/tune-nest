import { DEFAULT_SETTINGS, type AIProvider, type Settings } from '@/types'
import { getDesktop, unwrapDesktopResult, type ChatRequest } from './desktop'
import { AI_PROVIDERS, buildChatPayload } from './ai'

export async function loadSettings(): Promise<Settings> {
  const desktop = getDesktop()
  if (desktop) return unwrapDesktopResult(await desktop.getSettings())
  const stored = await chrome.storage.sync.get('settings')
  const local = await chrome.storage.local.get('aiKeys')
  const old = stored.settings || {}
  const keys = { ...local.aiKeys }
  const { deepseekApiKey: legacyKey, ...safe } = old
  if (legacyKey && !keys.deepseek) keys.deepseek = legacyKey
  if (legacyKey) {
    await chrome.storage.local.set({ aiKeys: keys })
    await chrome.storage.sync.set({ settings: { ...safe, aiProvider: old.aiProvider || 'deepseek' } })
  }
  return {
    ...DEFAULT_SETTINGS, ...safe,
    aiProvider: old.aiProvider || (legacyKey ? 'deepseek' : 'xbot'),
    aiKeys: {},
    aiKeyConfigured: Object.fromEntries(Object.keys(AI_PROVIDERS).map((id) => [id, !!keys[id]])),
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  const desktop = getDesktop()
  if (desktop) {
    unwrapDesktopResult(await desktop.saveSettings(settings))
    return
  }
  const local = await chrome.storage.local.get('aiKeys')
  const keys = { ...local.aiKeys, ...settings.aiKeys }
  await chrome.storage.local.set({ aiKeys: keys })
  const { aiKeys: _keys, aiKeyConfigured: _configured, ...safe } = settings
  await chrome.storage.sync.set({ settings: safe })
}

/** A one-run opt-out never writes or disables the saved AI configuration. */
export async function loadClassificationSettings(rulesOnly = false): Promise<Settings> {
  if (rulesOnly) return { ...DEFAULT_SETTINGS, enableAI: false, aiKeys: {}, aiKeyConfigured: {} }
  return loadSettings()
}

export async function requestAI(body: ChatRequest, settings: Settings): Promise<unknown> {
  const provider: AIProvider = settings.aiProvider
  const desktop = getDesktop()
  const pendingKey = settings.aiKeys[provider]
  if (desktop) return unwrapDesktopResult(await desktop.requestAI(provider, body, pendingKey))
  const local = await chrome.storage.local.get('aiKeys')
  const apiKey = (pendingKey ?? local.aiKeys?.[provider] ?? '').trim()
  if (!apiKey) throw new Error('请先配置当前渠道的 API Key')
  const response = await fetch(AI_PROVIDERS[provider].endpoint, {
    method: 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(buildChatPayload(provider, body)),
    signal: AbortSignal.timeout(90000),
  })
  if (!response.ok) throw new Error(`AI 请求失败（${response.status}），请检查当前渠道的密钥、余额和模型可用性`)
  const text = await response.text()
  if (text.length > 1_000_000) throw new Error('AI 响应过大')
  return JSON.parse(text)
}
