import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type AIProvider, type Settings } from '../src/types'
import { AI_PROVIDERS, buildChatPayload, hasAIKey, readAIContent } from '../src/platform/ai'
import { loadClassificationSettings, loadSettings, requestAI, saveSettings } from '../src/platform/settings'
import { classifyByAI } from '../src/classifier/ai-classifier'

vi.mock('../src/platform/desktop', () => ({ getDesktop: () => undefined }))

let local: Record<string, any>
let sync: Record<string, any>
beforeEach(() => {
  local = {}; sync = {}
  const area = (store: Record<string, any>) => ({
    get: vi.fn(async (key: string) => ({ [key]: store[key] })),
    set: vi.fn(async (data: object) => { Object.assign(store, data) }),
  })
  vi.stubGlobal('chrome', { storage: { local: area(local), sync: area(sync) } })
})

describe('AI channels', () => {
  it('can run rules only without reading or changing stored credentials', async () => {
    local.aiKeys = { xbot: 'test-saved-key' }
    sync.settings = { ...DEFAULT_SETTINGS, enableAI: true }
    const settings = await loadClassificationSettings(true)
    expect(settings.enableAI).toBe(false)
    expect(hasAIKey(settings)).toBe(false)
    expect(chrome.storage.sync.get).not.toHaveBeenCalled()
    expect(chrome.storage.local.get).not.toHaveBeenCalled()
    expect(chrome.storage.sync.set).not.toHaveBeenCalled()
    expect((await loadSettings()).enableAI).toBe(true)
  })
  it('migrates the legacy DeepSeek key out of synced settings', async () => {
    sync.settings = { deepseekApiKey: 'test-legacy-key', enableAI: true }
    const settings = await loadSettings()
    expect(settings.aiProvider).toBe('deepseek')
    expect(settings.aiKeys).toEqual({})
    expect(settings.aiKeyConfigured.deepseek).toBe(true)
    expect(local.aiKeys.deepseek).toBe('test-legacy-key')
    expect(sync.settings).not.toHaveProperty('deepseekApiKey')
  })
  it('keeps keys separate when switching, preserving untouched credentials', async () => {
    local.aiKeys = { deepseek: 'test-deepseek' }
    await saveSettings({ ...DEFAULT_SETTINGS, aiKeys: { xbot: 'test-xbot' } })
    expect(local.aiKeys).toEqual({ deepseek: 'test-deepseek', xbot: 'test-xbot' })
    expect(sync.settings).not.toHaveProperty('aiKeys')
    const loaded = await loadSettings()
    expect(hasAIKey(loaded)).toBe(true)
    expect(hasAIKey({ ...loaded, aiProvider: 'zhipu' })).toBe(false)
    expect(hasAIKey({ ...loaded, aiKeys: { xbot: '' } })).toBe(false)
  })
  it.each(['xbot', 'deepseek', 'zhipu'] as AIProvider[])('routes %s to only its own endpoint, key and model', async (aiProvider) => {
    local.aiKeys = { xbot: 'test-xbot', deepseek: 'test-deepseek', zhipu: 'test-zhipu' }
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] })))
    vi.stubGlobal('fetch', fetcher)
    await requestAI({ messages: [{ role: 'user', content: 'Hi' }], max_tokens: 256 }, { ...DEFAULT_SETTINGS, aiProvider })
    const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(AI_PROVIDERS[aiProvider].endpoint)
    expect((options.headers as Record<string, string>).Authorization).toBe(`Bearer test-${aiProvider}`)
    const payload = JSON.parse(options.body as string)
    expect(payload.model).toBe(AI_PROVIDERS[aiProvider].model)
    expect(payload[aiProvider === 'xbot' ? 'max_completion_tokens' : 'max_tokens']).toBe(256)
    expect(options.redirect).toBe('error')
  })
  it('does not expose upstream response text on authentication failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('secret-diagnostic', { status: 401 })))
    await expect(requestAI({ messages: [], max_tokens: 256 }, { ...DEFAULT_SETTINGS, aiKeys: { xbot: 'test' } })).rejects.toThrow('401')
  })
  it('requires actual content and rejects truncated successful HTTP responses', () => {
    expect(() => readAIContent({})).toThrow('有效内容')
    expect(() => readAIContent({ choices: [{ message: { content: 'OK' }, finish_reason: 'length' }] })).toThrow('长度限制')
    expect(buildChatPayload('xbot', { messages: [], max_tokens: 256 })).not.toHaveProperty('temperature')
  })
  it.each([
    '[{"id":999,"language":"华语"}]',
    '[{"id":1,"language":"invented"}]',
    '[{"id":1,"language":"华语"},{"id":1,"language":"华语"}]',
    '[]',
  ])('rejects unsafe classification output %s', async (content) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }))))
    await expect(classifyByAI([{ id: 1, name: '晴天', artists: '周杰伦', album: '叶惠美' }],
      { ...DEFAULT_SETTINGS, aiKeys: { xbot: 'test' } }, { language: ['华语'] })).rejects.toThrow()
  })
})

// Opt-in only: credentials are supplied via an ignored local file or environment.
// Public song metadata is sent to the explicitly selected provider; never print keys.
const liveProvider = process.env.TUNENEST_TEST_PROVIDER as AIProvider | undefined
it.skipIf(!liveProvider)('live provider: real classification with three known songs', async () => {
  const { readFileSync } = await import('node:fs')
  const credentials = process.env.TUNENEST_TEST_CREDENTIAL_FILE
    ? JSON.parse(readFileSync(process.env.TUNENEST_TEST_CREDENTIAL_FILE, 'utf8')) : {}
  const key = process.env.TUNENEST_TEST_KEY || credentials[liveProvider!]
  expect(typeof key === 'string' && key.length > 0).toBe(true)
  const settings: Settings = { ...DEFAULT_SETTINGS, aiProvider: liveProvider!, aiKeys: { [liveProvider!]: key } }
  const results = await classifyByAI([
    { id: 1, name: '晴天', artists: '周杰伦', album: '叶惠美' },
    { id: 2, name: 'Hello', artists: 'Adele', album: '25' },
    { id: 3, name: '海阔天空', artists: 'Beyond', album: '乐与怒' },
  ], settings, { language: ['华语', '英语', '粤语'] })
  expect(results.size).toBe(3)
  expect(results.get(1)?.language).toBe('华语')
  expect(results.get(2)?.language).toBe('英语')
  expect(results.get(3)?.language).toBe('粤语')
}, 100_000)
