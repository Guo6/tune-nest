import { DEFAULT_SETTINGS, type Settings } from '@/types'
import { getDesktop, unwrapDesktopResult, type ChatRequest } from './desktop'

export async function loadSettings(): Promise<Settings> {
  const desktop = getDesktop()
  if (desktop) return unwrapDesktopResult(await desktop.getSettings())
  const stored = await chrome.storage.sync.get('settings')
  return { ...DEFAULT_SETTINGS, ...stored.settings }
}

export async function saveSettings(settings: Settings): Promise<void> {
  const desktop = getDesktop()
  if (desktop) {
    unwrapDesktopResult(await desktop.saveSettings(settings))
    return
  }
  await chrome.storage.sync.set({ settings })
}

export async function requestDeepseek(body: ChatRequest, apiKey: string): Promise<unknown> {
  const desktop = getDesktop()
  if (desktop) return unwrapDesktopResult(await desktop.requestDeepseek(body, apiKey))
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  })
  if (!response.ok) throw new Error(`DeepSeek 请求失败（${response.status}）：${(await response.text()).slice(0, 200)}`)
  return response.json()
}
