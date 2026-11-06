import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

// Exercise the deployed standalone widget without touching real accounts or keys.
function widget(unauthorized = false, returnedKey = 'a'.repeat(48)) {
  const elements = new Map<string, any>()
  const el = (id: string) => {
    if (!elements.has(id)) elements.set(id, { hidden: ['panel', 'result'].includes(id), value: '', style: {}, setAttribute() {}, focus() {} })
    return elements.get(id)
  }
  const shadow = { innerHTML: '', getElementById: el, addEventListener() {} }
  const host = { hidden: false, attachShadow: () => shadow }
  const menuGroup = { insertBefore(node: any) { node.parentElement = this } }
  const about = { parentElement: menuGroup, nextSibling: null }
  const nav = { querySelector: () => about }
  const header = { querySelector: () => nav }
  const launcher = { hidden: false, parentElement: null, textContent: '', setAttribute() {}, focus() {}, remove() {}, getBoundingClientRect: () => ({ left: 500, bottom: 50 }) }
  let token: any
  let creates = 0
  let copied = ''
  const requests: string[] = []
  const fetcher = async (path: string, options: RequestInit) => {
    requests.push(path)
    if (unauthorized) return new Response('{}', { status: 401 })
    if (path === '/api/user/auth/refresh') return Response.json({ success: true, data: { access_token: 'test-session-jwt', user: { id: 42 } } })
    expect((options.headers as any).Authorization).toBe('Bearer test-session-jwt')
    expect((options.headers as any)['New-Api-User']).toBe('42')
    if (path === '/api/user/self') return Response.json({ success: true, data: { id: 42 } })
    if (path.startsWith('/api/token/search')) return Response.json({ success: true, data: { items: token ? [token] : [] } })
    if (path === '/api/token/') {
      creates++
      token = { ...JSON.parse(options.body as string), id: 77, status: 1 }
      expect(token.group).toBe('public')
      expect(token.model_limits).toBe('gpt-5.6-luna')
      expect(token.model_limits_enabled).toBe(true)
      expect(token.cross_group_retry).toBe(false)
      return Response.json({ success: true })
    }
    if (path === '/api/token/77/key') return Response.json({ success: true, data: { key: returnedKey } })
    throw new Error('Unexpected request')
  }
  runInNewContext(readFileSync('deploy/newapi/tunenest-onboarding.js', 'utf8'), {
    document: { getElementById: () => null, querySelector: () => header, createElement: (tag: string) => tag === 'button' ? launcher : host, body: { append() {} }, addEventListener() {} },
    location: { pathname: '/dashboard' },
    window: { innerWidth: 1280, innerHeight: 900, setInterval() {}, addEventListener() {} },
    MutationObserver: class { observe() {} },
    navigator: { clipboard: { writeText: async (text: string) => { copied = text } }, locks: { request: async (_key: string, action: () => Promise<void>) => action() } },
    fetch: fetcher, AbortSignal,
  })
  return { el: (id: string) => id === 'launcher' ? launcher : el(id), requests, creates: () => creates, copied: () => copied, launcher, menuGroup, shadow }
}

describe('New API onboarding widget', () => {
  it('creates an owned restricted token once, reuses it, copies it, and clears it on close', async () => {
    const w = widget()
    w.el('launcher').onclick()
    await w.el('create').onclick()
    expect(w.el('key').value).toBe('sk-' + 'a'.repeat(48))
    expect(w.el('result').hidden).toBe(false)
    await w.el('create').onclick()
    expect(w.creates()).toBe(1)
    await w.el('copy').onclick()
    expect(w.copied()).toBe('sk-' + 'a'.repeat(48))
    w.el('close').onclick()
    expect(w.el('key').value).toBe('')
    expect(w.el('result').hidden).toBe(true)
  })
  it('mounts TuneNest in the top menu and omits the login/register link from its panel', () => {
    const w = widget()
    expect(w.launcher.parentElement).toBe(w.menuGroup)
    expect(w.launcher.textContent).toBe('TuneNest')
    expect(w.shadow.innerHTML).not.toContain('href="/sign-in"')
  })
  it('preserves an existing sk- prefix without adding a second prefix', async () => {
    const key = 'sk-' + 'b'.repeat(48)
    const w = widget(false, key)
    w.el('launcher').onclick()
    await w.el('create').onclick()
    expect(w.el('key').value).toBe(key)
  })
  it('rejects masked key values instead of copying them as usable credentials', async () => {
    const w = widget(false, 'abcd**********efgh')
    w.el('launcher').onclick()
    await w.el('create').onclick()
    expect(w.el('key').value).toBe('')
    expect(w.el('status').textContent).toContain('未取得完整 Key')
  })
  it('requires an authenticated refresh session before creating or reading keys', async () => {
    const w = widget(true)
    w.el('launcher').onclick()
    await w.el('create').onclick()
    expect(w.requests).toEqual(['/api/user/auth/refresh'])
    expect(w.creates()).toBe(0)
    expect(w.el('status').textContent).toContain('请先登录')
    expect(w.el('key').value).toBe('')
  })
})
