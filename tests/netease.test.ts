import { createDecipheriv, constants, publicEncrypt } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encryptWeapi } from '../src/api/netease-crypto'
import { getCreatedPlaylistId, NeteaseApiError, requestNetease } from '../src/api/netease-request'
import { createPlaylistDirect, addSongsToPlaylistDirect, clearPlaylistTracks } from '../src/api/netease-direct'
import { createPlaylist } from '../src/api/netease'

function decrypt(text: string, key: string): string {
  const decipher = createDecipheriv('aes-128-cbc', key, '0102030405060708')
  return Buffer.concat([decipher.update(text, 'base64'), decipher.final()]).toString('utf8')
}

afterEach(() => vi.unstubAllGlobals())

describe('weapi wire format', () => {
  it('uses two AES-CBC layers and the web client RSA public key', () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(((bytes: Uint8Array) => {
      bytes.set(Array.from({ length: 16 }, (_, i) => i))
      return bytes
    }) as typeof crypto.getRandomValues)
    const payload = { name: '[TuneNest] 华语-语种歌单', privacy: 0, type: 'NORMAL', csrf_token: 'csrf-test' }
    const body = encryptWeapi(payload)
    const inner = decrypt(body.get('params')!, 'abcdefghijklmnop')
    expect(JSON.parse(decrypt(inner, '0CoJUm6Qyw8W8jud'))).toEqual(payload)

    const publicKey = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----`
    const padded = Buffer.alloc(128)
    padded.write('ponmlkjihgfedcba', 112)
    const expected = publicEncrypt({ key: publicKey, padding: constants.RSA_NO_PADDING }, padded)
    expect(body.get('encSecKey')).toBe(expected.toString('hex'))
    expect(body.get('encSecKey')).toHaveLength(256)
  })

  it('generates a fresh secret for every request', () => {
    const first = encryptWeapi({ name: '测试' })
    const second = encryptWeapi({ name: '测试' })
    expect(first.get('params')).not.toBe(second.get('params'))
    expect(first.get('encSecKey')).not.toBe(second.get('encSecKey'))
  })
})

describe('NetEase request handling', () => {
  it('encrypts creation requests and sends cookies and CSRF', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ code: 200, id: 123 }))
    vi.stubGlobal('fetch', fetchMock)
    const params = { name: '测试歌单', privacy: 0, type: 'NORMAL' }
    await requestNetease('/api/playlist/create', params, 'csrf-test')
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://music.163.com/weapi/playlist/create?csrf_token=csrf-test')
    expect(options.credentials).toBe('include')
    expect(options.method).toBe('POST')
    const body = new URLSearchParams(options.body)
    expect([...body.keys()].sort()).toEqual(['encSecKey', 'params'])
    expect(options.body).not.toContain('name=')
    expect(params).not.toHaveProperty('csrf_token')
  })

  it.each([
    [200, { code: 403, message: '操作过于频繁，请稍后再试' }, '操作过于频繁，请稍后再试（403）'],
    [403, { code: 403, msg: '请完成验证' }, '请完成验证（403）'],
    [200, { code: 403 }, '请求被网易云拒绝'],
    [200, { code: 301 }, '登录已失效'],
  ])('reports business and HTTP errors (%s, %j)', async (status, body, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body, { status })))
    await expect(requestNetease('/api/playlist/create', {}, 'csrf'))
      .rejects.toThrow(message)
  })

  it('handles an HTML HTTP 403 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Forbidden</html>', { status: 403 })))
    await expect(requestNetease('/api/playlist/create', {}, ''))
      .rejects.toMatchObject({ name: 'NeteaseApiError', code: 403 })
  })

  it('rejects malformed success responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Login</html>')))
    await expect(requestNetease('/api/user/playlist', {}, ''))
      .rejects.toThrow('无法识别的响应')
  })

  it('preserves ordinary read paths and GET parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ code: 200, playlist: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await requestNetease('/api/user/playlist', { uid: 42 }, 'token', 'GET')
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://music.163.com/api/user/playlist?uid=42&csrf_token=token')
    expect(options.body).toBeUndefined()
  })
})

describe('playlist API entry points', () => {
  it.each(['content', 'background'])('uses weapi in the %s entry point', async (entry) => {
    vi.stubGlobal('document', { cookie: 'other=1; __csrf=csrf-test' })
    vi.stubGlobal('chrome', { cookies: { get: vi.fn().mockResolvedValue({ value: 'csrf-test' }) } })
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ code: 200, playlist: { id: 456 } }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await (entry === 'content' ? createPlaylistDirect : createPlaylist)('测试')).toBe(456)
    expect(fetchMock.mock.calls[0][0]).toContain('/weapi/playlist/create?csrf_token=csrf-test')
  })

  it.each(['add', 'del'])('does not report %s tracks as successful on business failure', async (op) => {
    vi.stubGlobal('document', { cookie: '__csrf=token' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code: 403, message: '没有权限' })))
    const operation = op === 'add' ? addSongsToPlaylistDirect : clearPlaylistTracks
    await expect(operation(123, [1, 2])).rejects.toBeInstanceOf(NeteaseApiError)
  })

  it('accepts both creation ID formats and rejects missing or invalid IDs', () => {
    expect(getCreatedPlaylistId({ id: 123 })).toBe(123)
    expect(getCreatedPlaylistId({ playlist: { id: 456 } })).toBe(456)
    for (const response of [{}, { id: 0 }, { id: -1 }, { id: NaN }]) {
      expect(() => getCreatedPlaylistId(response)).toThrow('未返回有效的歌单 ID')
    }
  })
})
