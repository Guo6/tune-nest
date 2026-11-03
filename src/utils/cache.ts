import { getDesktop } from '@/platform/desktop'

const CACHE_PREFIX = 'tn_cache_'
const DEFAULT_TTL = 30 * 60 * 1000 // 30 分钟

interface CacheEntry<T> {
  data: T
  expiry: number
}

export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const cacheKey = CACHE_PREFIX + key
    const result = getDesktop()
      ? { [cacheKey]: JSON.parse(localStorage.getItem(cacheKey) || 'null') }
      : await chrome.storage.local.get(cacheKey)
    const entry = result[CACHE_PREFIX + key] as CacheEntry<T> | undefined
    if (!entry) return null
    if (Date.now() > entry.expiry) {
      if (getDesktop()) localStorage.removeItem(cacheKey)
      else await chrome.storage.local.remove(cacheKey)
      return null
    }
    return entry.data
  } catch {
    return null
  }
}

export async function setCache<T>(key: string, data: T, ttl = DEFAULT_TTL): Promise<void> {
  try {
    const entry: CacheEntry<T> = {
      data,
      expiry: Date.now() + ttl,
    }
    if (getDesktop()) localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry))
    else await chrome.storage.local.set({ [CACHE_PREFIX + key]: entry })
  } catch {
    // storage full or error, silently fail
  }
}

export async function clearCache(): Promise<void> {
  if (getDesktop()) {
    Object.keys(localStorage).filter((key) => key.startsWith(CACHE_PREFIX)).forEach((key) => localStorage.removeItem(key))
    return
  }
  const all = await chrome.storage.local.get(null)
  const cacheKeys = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX))
  if (cacheKeys.length > 0) {
    await chrome.storage.local.remove(cacheKeys)
  }
}
