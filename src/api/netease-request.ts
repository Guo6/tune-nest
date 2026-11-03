import { encryptWeapi } from './netease-crypto'

export const NETEASE_BASE_URL = 'https://music.163.com'

export class NeteaseApiError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message)
    this.name = 'NeteaseApiError'
  }
}

function apiError(code: number, detail?: unknown): NeteaseApiError {
  const message = typeof detail === 'string' ? detail.trim() : ''
  const hint = code === 403
    ? '请求被网易云拒绝，请在网页确认登录状态或完成验证后再试'
    : code === 301 || code === 401
    ? '登录已失效，请在网易云网页重新登录后再试'
    : '网易云请求失败'
  return new NeteaseApiError(code, `${message || hint}（${code}）`)
}

export async function requestNetease<T>(
  path: string,
  params: Record<string, string | number>,
  csrf: string,
  method: 'GET' | 'POST' = 'POST',
  fetcher: (url: string, options: RequestInit) => Promise<Response> = (url, options) => fetch(url, options),
  acceptedCodes: number[] = [],
): Promise<T> {
  // 创建歌单需要网页端的加密协议，不能向 /api/playlist/create 直接提交明文。
  const useWeapi = path === '/api/playlist/create'
    || path === '/api/w/nuser/account/get'
    || path.startsWith('/api/login/qrcode/')
  const url = new URL(`${NETEASE_BASE_URL}${useWeapi ? path.replace('/api/', '/weapi/') : path}`)
  const payload = { ...params, csrf_token: csrf }
  const options: RequestInit = {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }
  if (useWeapi) url.searchParams.set('csrf_token', csrf)
  if (method === 'POST') {
    options.body = (useWeapi
      ? encryptWeapi(payload)
      : new URLSearchParams(Object.entries(payload).map(([key, value]) => [key, String(value)]))
    ).toString()
  } else {
    Object.entries(payload).forEach(([key, value]) => url.searchParams.set(key, String(value)))
  }

  const response = await fetcher(url.toString(), options)
  let data: { code?: number; message?: string; msg?: string }
  try {
    data = await response.json()
  } catch {
    throw apiError(response.status, response.ok ? '网易云返回了无法识别的响应' : undefined)
  }
  if (!response.ok) throw apiError(response.status, data?.message || data?.msg)
  // 网易云的业务错误通常由 HTTP 200 包裹，添加/删除歌曲也必须检查。
  if (data?.code !== undefined && data.code !== 200 && !acceptedCodes.includes(data.code)) {
    throw apiError(data.code, data.message || data.msg)
  }
  return data as T
}

export function getCreatedPlaylistId(response: { id?: number; playlist?: { id: number } }): number {
  const id = response.id || response.playlist?.id
  if (!id || !Number.isSafeInteger(id) || id <= 0) {
    throw new Error('创建歌单失败：网易云未返回有效的歌单 ID，请先在网页检查歌单是否已创建')
  }
  return id
}
