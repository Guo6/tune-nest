import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AISetupGate } from '../src/panel/pages/AISetupGate'
import { PanelApp } from '../src/panel/App'
import { DEFAULT_SETTINGS, type Settings } from '../src/types'

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), request: vi.fn() }))
vi.mock('../src/platform/settings', () => ({ loadSettings: mocks.load, saveSettings: mocks.save, requestAI: mocks.request }))
vi.mock('../src/platform/desktop', () => ({ getDesktop: () => ({ version: 'test' }) }))
vi.mock('../src/panel/pages/LoginCheck', () => ({ LoginCheck: ({ onSuccess }: any) => createElement('button', { onClick: () => onSuccess(42) }, '测试登录') }))
vi.mock('../src/panel/pages/PlaylistSelect', () => ({ PlaylistSelect: ({ onConfirm }: any) => createElement('button', {
  onClick: () => onConfirm([{ id: 1, name: '测试歌单' }], [{ id: 1, name: '晴天' }]),
}, '选择测试歌单') }))
vi.mock('../src/panel/pages/ClassifyProgress', () => ({ ClassifyProgress: ({ songs, rulesOnly }: any) => createElement('div', { 'data-testid': 'run' }, `${rulesOnly ? '规则' : 'AI'}分类·${songs[0].name}`) }))

let renderer: ReactTestRenderer
const text = (node: ReactTestInstance): string => node.children.map((child) => typeof child === 'string' ? child : text(child)).join('')
const button = (label: string) => renderer.root.findAllByType('button').find((node) => text(node) === label)!
const click = async (label: string) => { await act(async () => { await button(label).props.onClick() }) }
const configured: Settings = { ...DEFAULT_SETTINGS, aiKeyConfigured: { xbot: true } }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.load.mockResolvedValue(DEFAULT_SETTINGS)
  mocks.save.mockResolvedValue(undefined)
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
})
afterEach(() => { if (renderer) act(() => renderer.unmount()) })

async function renderGate() {
  const onContinue = vi.fn()
  await act(async () => { renderer = create(createElement(AISetupGate, { onContinue, onBack: vi.fn() })) })
  return onContinue
}

describe('AI setup workflow', () => {
  it.each(['xbot', 'deepseek', 'zhipu'] as const)('continues with configured %s without making an AI request', async (aiProvider) => {
    mocks.load.mockResolvedValue({ ...DEFAULT_SETTINGS, aiProvider, aiKeyConfigured: { [aiProvider]: true } })
    const next = await renderGate()
    expect(next).toHaveBeenCalledWith(false)
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('lets users skip for this run without modifying saved settings', async () => {
    const next = await renderGate()
    expect(text(renderer.root)).toContain('建议先配置 AI 渠道')
    await click('暂不配置，继续分类')
    expect(next).toHaveBeenCalledWith(true)
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalled()
  })
  it('does not treat another provider key as configuration of the selected provider', async () => {
    mocks.load.mockResolvedValue({ ...DEFAULT_SETTINGS, aiKeyConfigured: { deepseek: true } })
    const next = await renderGate()
    expect(next).not.toHaveBeenCalled()
    expect(text(renderer.root)).toContain('尚未配置 API Key')
  })
  it('guides users to enable AI when a key is saved but AI is disabled', async () => {
    mocks.load.mockResolvedValue({ ...configured, enableAI: false })
    const next = await renderGate()
    expect(text(renderer.root)).toContain('尚未启用 AI')
    await click('去配置 AI 渠道')
    const checkbox = renderer.root.findAllByType('input').find((input) => input.props.type === 'checkbox')!
    act(() => checkbox.props.onChange({ target: { checked: true } }))
    mocks.load.mockResolvedValue(configured)
    await click('保存并继续分类')
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ enableAI: true }))
    expect(next).toHaveBeenCalledWith(false)
  })
  it('allows rules-only continuation if credential storage cannot be read', async () => {
    mocks.load.mockRejectedValue(new Error('credential storage unavailable'))
    const next = await renderGate()
    expect(text(renderer.root)).toContain('暂时无法读取 AI 设置')
    await click('暂不配置，继续分类')
    expect(next).toHaveBeenCalledWith(true)
  })
  it('never starts automatically when saving an incomplete configuration', async () => {
    const next = await renderGate()
    await click('去配置 AI 渠道')
    await click('保存并继续分类')
    expect(next).not.toHaveBeenCalled()
    expect(text(renderer.root)).toContain('请填写当前渠道的 API Key 并启用 AI')
  })
})

describe('classification entry integration', () => {
  async function enter() {
    await act(async () => { renderer = create(createElement(PanelApp)) })
    await click('测试登录')
    const nav = renderer.root.findAllByType('button').find((node) => node.props.className?.includes('desktop-nav-item') && text(node).includes('智能歌单分类'))!
    await act(async () => { nav.props.onClick() })
  }
  it('carries an explicit skip through song selection and the start button', async () => {
    await enter()
    await click('暂不配置，继续分类')
    await click('选择测试歌单')
    await click('开始分类')
    expect(text(renderer.root.findByProps({ 'data-testid': 'run' }))).toBe('规则分类·晴天')
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('rechecks before execution and resumes with the same songs after configuring AI', async () => {
    mocks.load.mockResolvedValue(configured)
    await enter()
    await click('选择测试歌单')
    mocks.load.mockResolvedValue(DEFAULT_SETTINGS)
    await click('开始分类')
    await click('去配置 AI 渠道')
    act(() => renderer.root.findByProps({ id: 'ai-key' }).props.onChange({ target: { value: 'test-pending-key' } }))
    mocks.load.mockResolvedValue(configured)
    await click('保存并继续分类')
    expect(text(renderer.root.findByProps({ 'data-testid': 'run' }))).toBe('AI分类·晴天')
    expect(mocks.request).not.toHaveBeenCalled()
  })
})
