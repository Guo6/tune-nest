import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { Settings } from '@/types'

export type DesktopResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string; code?: number } }

export interface ChatRequest {
  model: 'deepseek-chat'
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  max_tokens: number
  temperature?: number
}

export interface DesktopBridge {
  readonly version: string
  getNeteaseCsrf(): Promise<DesktopResult<string>>
  getNeteaseLoginState(): Promise<DesktopResult<{ hasMusicU: boolean; hasCsrf: boolean }>>
  fetchNetease(url: string, method: string, body: string, headers: Record<string, string>): Promise<DesktopResult<{ status: number; body: string }>>
  storeNeteaseCookie(cookie: string): Promise<DesktopResult<void>>
  startQqQrLogin(): Promise<DesktopResult<{ image: string }>>
  pollQqQrLogin(): Promise<DesktopResult<{ status: 'waiting' | 'scanned' | 'expired' | 'success' }>>
  getQqSessionState(): Promise<DesktopResult<{ userId: string | null; hasMusicKey: boolean }>>
  fetchQq(url: string, method: string, body: string): Promise<DesktopResult<{ status: number; body: string }>>
  getSettings(): Promise<DesktopResult<Settings>>
  saveSettings(settings: Settings): Promise<DesktopResult<void>>
  requestDeepseek(body: ChatRequest, apiKey?: string): Promise<DesktopResult<unknown>>
  onLoginChanged(callback: () => void): () => void
}

let desktopBridge: DesktopBridge | undefined

export function getDesktop(): DesktopBridge | undefined {
  if (!isTauri()) return undefined
  if (desktopBridge) return desktopBridge
  const invokeResult = <T>(command: string, args?: Record<string, unknown>) =>
    invoke<T>(command, args).then((data): DesktopResult<T> => ({ ok: true, data }))
      .catch((error): DesktopResult<T> => ({
        ok: false,
        error: { message: error instanceof Error ? error.message : String(error) },
      }))

  desktopBridge = {
    version: '0.1.8',
    getNeteaseCsrf: () => invokeResult('get_netease_csrf'),
    getNeteaseLoginState: () => invokeResult('get_netease_login_state'),
    fetchNetease: (url, method, body, headers) => invokeResult('fetch_netease', { url, method, body, headers }),
    storeNeteaseCookie: (cookie) => invokeResult('store_netease_cookie', { cookie }),
    startQqQrLogin: () => invokeResult('start_qq_qr_login'),
    pollQqQrLogin: () => invokeResult('poll_qq_qr_login'),
    getQqSessionState: () => invokeResult('get_qq_session_state'),
    fetchQq: (url, method, body) => invokeResult('fetch_qq', { url, method, body }),
    getSettings: () => invokeResult('get_settings'),
    saveSettings: (settings) => invokeResult<void>('save_settings', { settings }),
    requestDeepseek: (body, apiKey) => invokeResult('request_deepseek', { body, apiKey }),
    onLoginChanged: (callback) => {
      let disposed = false
      let dispose: (() => void) | undefined
      void listen('tunenest://login-changed', callback).then((unlisten) => {
        if (disposed) unlisten()
        else dispose = unlisten
      })
      return () => { disposed = true; dispose?.() }
    },
  }
  return desktopBridge
}

export function unwrapDesktopResult<T>(result: DesktopResult<T>): T {
  if (!result.ok) {
    const error = new Error(result.error.message)
    Object.assign(error, { code: result.error.code })
    throw error
  }
  return result.data
}
