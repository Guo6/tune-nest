import CryptoJS from 'crypto-js'

const IV = CryptoJS.enc.Utf8.parse('0102030405060708')
const PRESET_KEY = '0CoJUm6Qyw8W8jud'
const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
// 网易云网页端 weapi 的 RSA 公钥（指数 0x10001），使用无填充 RSA。
const MODULUS = BigInt('0xe0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7')

function aesEncrypt(text: string, key: string): string {
  return CryptoJS.AES.encrypt(text, CryptoJS.enc.Utf8.parse(key), {
    iv: IV,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  }).toString()
}

function encryptSecret(secret: string): string {
  const reversed = [...secret].reverse()
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  let base = BigInt(`0x${reversed}`)
  let exponent = 0x10001n
  let result = 1n
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * base) % MODULUS
    base = (base * base) % MODULUS
    exponent >>= 1n
  }
  return result.toString(16).padStart(256, '0')
}

export function encryptWeapi(params: Record<string, string | number>): URLSearchParams {
  // getRandomValues 在 HTTP 内容脚本中也可用；AES 不依赖安全上下文的 subtle API。
  const random = crypto.getRandomValues(new Uint8Array(16))
  const secret = Array.from(random, (value) => BASE62[value % BASE62.length]).join('')
  return new URLSearchParams({
    params: aesEncrypt(aesEncrypt(JSON.stringify(params), PRESET_KEY), secret),
    encSecKey: encryptSecret(secret),
  })
}
