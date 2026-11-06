import type { AIProvider, Settings } from '@/types'
import type { ChatRequest } from './desktop'

export const AI_PROVIDERS = {
  xbot: {
    name: 'Xbot AI 中转站', model: 'gpt-5.6-luna',
    endpoint: 'https://newadm.xbotai.cc/v1/chat/completions',
    keyUrl: 'https://newadm.xbotai.cc/sign-up',
  },
  deepseek: {
    name: 'DeepSeek', model: 'deepseek-flash',
    endpoint: 'https://api.deepseek.com/chat/completions',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  zhipu: {
    name: '智谱', model: 'glm-4-flash-250414',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
  },
} as const

export function hasAIKey(settings: Settings): boolean {
  const pending = settings.aiKeys[settings.aiProvider]
  return pending === undefined ? !!settings.aiKeyConfigured[settings.aiProvider] : !!pending.trim()
}

export function buildChatPayload(provider: AIProvider, body: ChatRequest) {
  const common = { model: AI_PROVIDERS[provider].model, messages: body.messages, stream: false }
  return provider === 'xbot'
    ? { ...common, max_completion_tokens: body.max_tokens, reasoning_effort: 'none' }
    : { ...common, max_tokens: body.max_tokens, temperature: 0, thinking: { type: 'disabled' } }
}

export function readAIContent(data: unknown): string {
  const result = data as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }> }
  const choice = result?.choices?.[0]
  if (choice?.finish_reason === 'length') throw new Error('AI 输出达到长度限制，请减小每批歌曲数后重试')
  const content = choice?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new Error('AI 没有返回有效内容')
  return content.trim()
}
