/* Xbot AI add-on for New API rc.48. No credentials are stored by this widget. */
(() => {
  'use strict';
  if (document.getElementById('tunenest-onboarding')) return;
  const host = document.createElement('div');
  host.id = 'tunenest-onboarding';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{font:14px/1.6 system-ui,sans-serif;color:var(--popover-foreground,#18202c)}
    *{box-sizing:border-box}button{font:inherit;cursor:pointer;border:0;border-radius:10px;padding:10px 14px;background:#e73551;color:white}button:disabled{opacity:.55;cursor:wait}
    #panel{position:fixed;z-index:1000;top:74px;right:18px;width:min(360px,calc(100vw - 32px));background:var(--popover,#fff);border:1px solid var(--border,#ddd);border-radius:16px;padding:20px;box-shadow:0 10px 40px #0003;max-height:75vh;overflow:auto}
    [hidden]{display:none!important}h2{font-size:18px;margin:0 0 10px}p{margin:8px 0}ol{padding-left:20px;font-size:13px}#close{float:right;background:#eee;color:#444;padding:2px 10px}input{width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;font:inherit}#status{font-size:13px;overflow-wrap:anywhere}a{color:#bc2340}.note{font-size:12px;color:#667085}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
  </style>
  <section id="panel" role="region" aria-label="TuneNest API Key 引导" hidden>
    <button id="close" aria-label="关闭引导">×</button><h2>连接 TuneNest</h2>
    <p>使用你的 Xbot AI 账户额度，为 TuneNest 开启 AI 歌曲分类。</p>
    <p class="note">渠道：Xbot AI 中转站<br>模型：gpt-5.6-luna</p>
    <button id="create">创建 / 获取 API Key</button>
    <p id="status" role="status" aria-live="polite"></p>
    <div id="result" hidden><label>你的 API Key<input id="key" type="password" readonly autocomplete="off"></label>
      <div class="actions"><button id="copy">复制 API Key</button></div>
      <ol><li>打开 TuneNest → 设置。</li><li>AI 渠道选择「Xbot AI 中转站」。</li><li>粘贴 API Key，保存并点击「测试实际调用」。</li></ol>
    </div>
    <p class="note">此 Key 仅可调用 Luna 公益模型，使用账户已有额度；创建 Key 不会增加余额。请勿分享密钥。</p>
    <a href="/keys">管理和撤销 API Key</a>
  </section>`;
  document.body.append(host);
  const launcher = document.createElement('button');
  launcher.id = 'tunenest-menu-button';
  launcher.type = 'button';
  launcher.textContent = 'TuneNest';
  launcher.className = 'text-muted-foreground hover:text-foreground min-w-0 shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-200';
  launcher.setAttribute('aria-expanded', 'false');
  const el = (id) => id === 'launcher' ? launcher : root.getElementById(id);
  function mountMenu() {
    const header = document.querySelector('header');
    if (!header) { launcher.remove(); return; }
    const nav = header.querySelector('nav') || header;
    const about = nav.querySelector('a[href="/about"]');
    const wide = window.innerWidth >= 1024;
    const target = wide && about ? about.parentElement : nav;
    if (launcher.parentElement === target) return;
    target.insertBefore(launcher, wide && about ? about.nextSibling : target.lastElementChild);
  }
  function positionPanel() {
    if (el('panel').hidden) return;
    const rect = launcher.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 32);
    const top = rect.bottom + 10;
    el('panel').style.left = `${Math.max(16, Math.min(rect.left, window.innerWidth - width - 16))}px`;
    el('panel').style.top = `${top}px`;
    el('panel').style.maxHeight = `${Math.max(120, window.innerHeight - top - 16)}px`;
  }
  mountMenu();
  new MutationObserver(mountMenu).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', () => { mountMenu(); positionPanel(); });
  window.addEventListener('scroll', positionPanel, { passive: true });
  let busy = false;
  let generation = 0;
  let lastPath = location.pathname;
  function clear() { el('key').value = ''; el('key').type = 'password'; el('result').hidden = true; }
  function close() { generation++; clear(); el('panel').hidden = true; el('launcher').setAttribute('aria-expanded', 'false'); }
  function syncRoute() {
    if (location.pathname !== lastPath) { close(); lastPath = location.pathname; }
    host.hidden = ['/sign-in', '/sign-up', '/forgot-password'].includes(location.pathname);
    launcher.hidden = host.hidden;
    mountMenu();
  }
  syncRoute();
  window.setInterval(syncRoute, 500);
  window.addEventListener('pagehide', close);
  el('close').onclick = close;
  el('launcher').onclick = () => {
    if (!el('panel').hidden) { close(); return; }
    el('panel').hidden = false;
    el('launcher').setAttribute('aria-expanded', 'true');
    positionPanel();
  };
  document.addEventListener('pointerdown', (event) => {
    if (!event.composedPath().includes(host) && !event.composedPath().includes(launcher)) close();
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !el('panel').hidden) { close(); el('launcher').focus(); } });
  async function api(path, method = 'GET', body, session) {
    const headers = { 'Content-Type': 'application/json' };
    if (session) { headers.Authorization = `Bearer ${session.access_token}`; headers['New-Api-User'] = String(session.user.id); }
    const response = await fetch(path, {
      method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20000),
    });
    if (response.status === 401 || response.status === 403) throw new Error('请先登录 Xbot AI，登录后再获取 Key。');
    if (!response.ok) throw new Error(`请求失败（${response.status}），请稍后重试。`);
    const value = await response.json();
    if (!value.success) throw new Error('操作未完成，请到 API Key 管理页面检查；再次获取时会先查找已有 Key。');
    return value.data;
  }
  const tokenName = 'TuneNest Luna';
  async function findToken(session) {
    const data = await api('/api/token/search?keyword=TuneNest%20Luna&p=1&size=100', 'GET', undefined, session);
    return (data?.items || []).find((token) => token.name === tokenName && token.group === 'public'
      && token.status === 1 && token.model_limits_enabled && token.model_limits === 'gpt-5.6-luna'
      && token.expired_time === -1 && token.unlimited_quota);
  }
  async function getKey() {
    const expectedGeneration = generation;
    // rc.48 uses in-memory JWTs. Refresh with the existing HttpOnly session cookie;
    // no localStorage token or upstream credential is read or persisted.
    const session = await api('/api/user/auth/refresh', 'POST');
    if (!session?.access_token || !session.user?.id) throw new Error('请先登录后获取 Key。');
    const self = await api('/api/user/self', 'GET', undefined, session);
    if (self.id !== session.user.id) throw new Error('账户校验失败，请重新登录。');
    let token = await findToken(session);
    if (!token) {
      await api('/api/token/', 'POST', {
        name: tokenName, expired_time: -1, remain_quota: 0, unlimited_quota: true,
        model_limits_enabled: true, model_limits: 'gpt-5.6-luna', group: 'public',
        allow_ips: '', cross_group_retry: false, allow_user_quota_query: true,
      }, session);
      token = await findToken(session);
    }
    if (!token) throw new Error('创建结果尚未确认，请稍后再次获取；系统会先查找已有 Key。');
    const data = await api(`/api/token/${token.id}/key`, 'POST', undefined, session);
    if (generation !== expectedGeneration) return;
    const key = typeof data?.key === 'string' ? data.key.trim() : '';
    // rc.48 returns token.Key verbatim; native UI prepends sk- when copying it.
    if (!/^(?:sk-)?[A-Za-z0-9_-]{32,128}$/.test(key)) throw new Error('未取得完整 Key，请到 API Key 管理页面查看。');
    if (el('panel').hidden) return;
    el('key').value = key.startsWith('sk-') ? key : `sk-${key}`;
    el('result').hidden = false;
    el('status').textContent = 'Key 已就绪，请复制到 TuneNest 设置。';
  }
  el('create').onclick = async () => {
    if (busy) return;
    busy = true; el('create').disabled = true; clear();
    el('status').textContent = '正在检查账户和已有 Key…';
    try {
      if (navigator.locks) await navigator.locks.request('tunenest-key', getKey);
      else await getKey();
    } catch (error) {
      clear();
      el('status').textContent = error.name === 'TimeoutError'
        ? '请求超时，结果尚未确认。请再次获取，系统会先查找已有 Key。'
        : (error.message || '操作失败，请到 API Key 管理页面检查。');
    } finally { busy = false; el('create').disabled = false; }
  };
  el('copy').onclick = async () => {
    try { await navigator.clipboard.writeText(el('key').value); el('status').textContent = '已复制。请到 TuneNest → 设置 → Xbot AI 中转站中粘贴并保存。'; }
    catch { el('key').type = 'text'; el('key').select(); el('status').textContent = '浏览器未允许自动复制，请按 Ctrl+C / Command+C 复制。'; }
  };
})();
