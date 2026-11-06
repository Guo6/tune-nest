import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OptionsApp } from '../src/options/OptionsApp'
import { DEFAULT_SETTINGS, type AIProvider } from '../src/types'
import fixture from './fixtures/ai-ipc-request.json'

// Only the native invoke boundary is mocked: render the actual settings page,
// call requestAI through the real desktop bridge, and inspect the wire payload.
const core = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: core.invoke, isTauri: () => true }))

let renderer: ReactTestRenderer | undefined
let provider: AIProvider
const text = (node: ReactTestInstance): string => node.children.map((child) => typeof child === 'string' ? child : text(child)).join('')
beforeEach(() => {
  provider = 'xbot'
  core.invoke.mockReset()
  core.invoke.mockImplementation(async (command: string) => {
    if (command === 'get_settings') return { ...DEFAULT_SETTINGS, aiProvider: provider, aiKeyConfigured: { [provider]: true } }
    if (command === 'request_ai') return { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }
    throw new Error('Unexpected command')
  })
})
afterEach(() => { if (renderer) act(() => { renderer?.unmount(); renderer = undefined }) })

describe('settings → desktop AI command contract', () => {
  it.each(fixture.providers as AIProvider[])('sends the shared Rust-readable request for %s and checks actual content', async (selected) => {
    provider = selected
    await act(async () => { renderer = create(createElement(OptionsApp, { embedded: true })) })
    const test = renderer!.root.findAllByType('button').find((node) => text(node) === '测试实际调用')!
    expect(test.props.disabled).toBe(false)
    await act(async () => { await test.props.onClick() })
    const call = core.invoke.mock.calls.find(([command]) => command === 'request_ai')!
    expect(JSON.parse(JSON.stringify(call[1]))).toEqual({ provider: selected, body: fixture.body })
    expect(text(renderer!.root)).toContain('实际调用成功')
  })

  it('shows native argument errors instead of claiming a successful connection', async () => {
    await act(async () => { renderer = create(createElement(OptionsApp, { embedded: true })) })
    core.invoke.mockRejectedValueOnce('invalid args: missing field maxTokens')
    const test = renderer!.root.findAllByType('button').find((node) => text(node) === '测试实际调用')!
    await act(async () => { await test.props.onClick() })
    expect(text(renderer!.root)).toContain('missing field maxTokens')
    expect(text(renderer!.root)).not.toContain('实际调用成功')
  })
})
