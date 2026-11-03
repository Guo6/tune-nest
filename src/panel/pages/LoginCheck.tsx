import { useEffect, useRef, useState } from 'react'
import { getMusicAdapter, type MusicPlatform } from '@/adapters'
import { getDesktop } from '@/platform/desktop'

interface Props {
  platform: MusicPlatform
  onPlatformChange: (platform: MusicPlatform) => void
  onSuccess: (uid: number) => void
}

export function LoginCheck({ platform, onPlatformChange, onSuccess }: Props) {
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [qrImage, setQrImage] = useState<string | null>(null)
  const [qrKey, setQrKey] = useState<string | undefined>()
  const [qrActive, setQrActive] = useState(false)
  const [qrStatus, setQrStatus] = useState('')
  const [loadingQr, setLoadingQr] = useState(false)
  const desktop = getDesktop()
  const adapter = getMusicAdapter(platform)
  const checkingRef = useRef(false)
  const pendingCheck = useRef(false)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const checkLogin = async (afterQrSuccess = false) => {
    if (checkingRef.current) {
      if (afterQrSuccess) pendingCheck.current = true
      return
    }
    checkingRef.current = true
    setChecking(true)
    setError(null)
    try {
      const profile = await adapter.getLoginStatus()
      if (!mountedRef.current) return
      if (profile) onSuccess(profile.userId)
      else setError(afterQrSuccess
        ? `${adapter.name}扫码已确认，但账号验证仍未通过。请刷新二维码重试。`
        : `请先登录${adapter.name}`)
    } catch (err) {
      if (!mountedRef.current) return
      setError(err instanceof Error ? err.message : '检测登录状态失败，请重试')
    } finally {
      if (!mountedRef.current) return
      setChecking(false)
      checkingRef.current = false
      if (pendingCheck.current) {
        pendingCheck.current = false
        queueMicrotask(() => { void checkLogin(true) })
      }
    }
  }

  useEffect(() => {
    setQrImage(null)
    setQrKey(undefined)
    setQrActive(false)
    setQrStatus('')
    void checkLogin()
    const unlisten = platform === 'netease'
      ? desktop?.onLoginChanged(() => { void checkLogin() }) : undefined
    return () => { unlisten?.() }
  }, [platform])

  useEffect(() => {
    if (!qrActive || !desktop) return
    let stopped = false
    let inFlight = false
    const poll = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const status = await adapter.pollQrLogin(qrKey)
        if (stopped) return
        if (status === 'success') {
          setQrStatus('登录成功，正在读取账号…')
          setQrActive(false)
          await checkLogin(true)
        } else if (status === 'scanned') {
          setQrStatus('已扫码，请在手机上确认登录')
        } else if (status === 'expired') {
          setQrStatus('二维码已过期，请刷新')
          setQrActive(false)
          setQrImage(null)
        } else {
          setQrStatus(`等待使用${platform === 'qq' ? '手机 QQ' : '网易云音乐 App'}扫码…`)
        }
      } catch (err) {
        if (!stopped) {
          setQrActive(false)
          setError(err instanceof Error ? err.message : '检查扫码状态失败')
        }
      } finally { inFlight = false }
    }
    const timer = window.setInterval(() => { void poll() }, 3000)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [qrActive, qrKey, platform])

  const startQrLogin = async () => {
    if (!desktop) return
    setLoadingQr(true)
    setError(null)
    setQrImage(null)
    setQrActive(false)
    try {
      const result = await adapter.startQrLogin()
      setQrImage(result.image)
      setQrKey(result.key)
      setQrActive(true)
      setQrStatus(`等待使用${platform === 'qq' ? '手机 QQ' : '网易云音乐 App'}扫码…`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取登录二维码失败')
    } finally { setLoadingQr(false) }
  }

  return (
    <div className="flex flex-col items-center justify-center py-16">
      {desktop && <>
        <div className="text-4xl mb-5">♫</div>
        <h2 className="text-xl font-semibold text-gray-800 mb-3">把喜欢的音乐，整理成歌单</h2>
        <div className="flex gap-2 mb-5">
          {(['netease', 'qq'] as const).map((item) => (
            <button key={item} className={`tn-btn ${platform === item ? 'tn-btn-primary' : 'tn-btn-secondary'}`}
              onClick={() => onPlatformChange(item)}>
              {item === 'qq' ? 'QQ 音乐' : '网易云音乐'}
            </button>
          ))}
        </div>
        <p className="text-sm text-gray-500 mb-6 max-w-sm text-center leading-6">
          使用{platform === 'qq' ? '手机 QQ' : '网易云音乐 App'}扫描下方二维码并确认登录。
        </p>
      </>}
      {error ? <p className="text-red-500 text-sm mb-4 text-center max-w-md">{error}</p>
        : checking && <p className="text-gray-500 text-sm mb-4">正在检测登录状态…</p>}
      <div className="flex gap-3">
        {desktop && <button className="tn-btn tn-btn-primary" onClick={startQrLogin} disabled={loadingQr}>
          {loadingQr ? '获取二维码…' : qrImage ? '刷新二维码' : '扫码登录'}
        </button>}
        <button className={`tn-btn ${desktop ? 'tn-btn-secondary' : 'tn-btn-primary'}`}
          onClick={() => { void checkLogin() }} disabled={checking}>
          {desktop ? '我已登录，重新检测' : '重新检测'}
        </button>
      </div>
      {qrImage && desktop && <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <img src={qrImage} alt={`${adapter.name}登录二维码`} className="w-44 h-44 mx-auto" />
        <p className="text-xs text-gray-500 text-center mt-3">{qrStatus}</p>
      </div>}
    </div>
  )
}
