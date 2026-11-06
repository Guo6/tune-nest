# Xbot AI / New API 的 TuneNest 获取 Key 菜单

适配 New API `v1.0.0-rc.48` 默认前端；验证日期为 2026-11-06。服务器上的源码快照可能早于镜像，排查时以实际镜像及对应 tag 的 API 为准。

## 用户流程

1. 访问 `https://newadm.xbotai.cc/sign-up` 注册并登录。
2. 点击顶部菜单「TuneNest」，再点击「创建 / 获取 API Key」。
3. 复制到 TuneNest → 设置 → Xbot AI 中转站 → API Key，保存并测试实际调用。
4. 在 `https://newadm.xbotai.cc/keys` 管理、禁用或撤销 Key。

「TuneNest」入口位于顶部导航，点击展开获取 Key 面板；面板不显示登录 / 注册链接。入口在登录、注册和找回密码页面隐藏，首页和控制台显示。未登录时点击获取会提示先登录。创建操作由用户点击触发，不自动领取或增加余额。

## 实现及边界

- `deploy/newapi/tunenest-onboarding.js` 使用 Shadow DOM，避免干扰原页面样式。
- rc.48 使用内存 JWT 和 HttpOnly 刷新 Cookie。组件使用同源 `POST /api/user/auth/refresh` 获取会话，再核对 `/api/user/self`；不读取或持久化网页登录凭据。
- 只查询当前用户的 `TuneNest Luna` Key。有效 Key 必须属于 `public` 分组，启用模型限制且只允许 `gpt-5.6-luna`；已有符合条件的 Key 会复用。
- 使用原生用户接口创建；`unlimited_quota=true` 只表示 Key 本身不另设固定额度上限，**仍受账户余额限制**，方便继续使用每日签到额度。跨分组重试关闭。
- 浏览器内防重复点击，有 Web Locks 时跨标签页串行执行。每次先查再创建，超时不自动重试创建，再次点击先读回检查。原生 API 没有幂等键，不保证跨设备同时操作时绝无重复。
- 关闭浮窗或页面跳转会清空 Key；复制失败时支持手动选择复制。Key 不放进 URL、日志或 localStorage。
- 没有管理员凭据和额外服务进程，上游凭据继续由 New API 管理。

## 部署与回滚

将 `deploy/newapi/` 内两个文件复制到服务器 `/root/tunenest-onboarding/`，运行：

```bash
python3 /root/tunenest-onboarding/install-widget.py
```

安装脚本在 `/root/new-api-backups/widget-<UTC时间>/` 备份 Caddy 配置及已有 HTML；从 `http://127.0.0.1:3000/` 获取当前 HTML，保留脚本、品牌和版权，添加同源浮窗脚本。文件放在 `/var/www/xbot-tunenest/`。只在 `newadm.xbotai.cc` 对浏览器 HTML 导航返回此文件，API、OAuth 和静态资源继续走原反向代理。验证 Caddy 配置后 reload，验证失败则还原配置。

**每次升级 New API 镜像后必须重新运行安装脚本**，让 HTML 静态资源散列与新镜像保持一致，否则可能白屏。脚本可重复运行。

首次安装前的 Caddyfile 备份可以还原并 reload，以取消浮窗；后续备份包含当时的浮窗配置。勿把数据库备份、会话、Key 或服务器环境文件提交到 Git。

## 公益模型

- 当前 `public` 渠道只提供 `gpt-5.6-luna`，不改原 GPT / Claude 渠道。
- `UserUsableGroups` 追加 `public`，保留原分组；`GroupRatio.public=1`。
- 此次 Luna 的 `ModelRatio=0.1`、`CompletionRatio=6`、`CacheRatio=0.1`，对应站内参考输入 $0.20 / 百万、输出 $1.20 / 百万、缓存输入 $0.02 / 百万 Token。站内计价不等于第三方上游实际成本，应另行核对上游价格。
- 新用户赠送及签到沿用原配置，创建 Key 不发放重复奖励。

## 验证范围

已验证网页浮窗显示和匿名登录提示；单元测试覆盖创建、复用、模型/分组限制、复制和关闭清空。真实测试使用临时账户和半小时有效、$0.01 限额的 Key，通过公网 Xbot AI 完成 Luna 调用、TuneNest 三首歌曲分类和桌面 Rust 请求验证。正式账号点击创建长期 Key 的人工验收仍应在实际推广前确认。

重跑真实调用测试需显式设置 `TUNENEST_TEST_PROVIDER` 和 `TUNENEST_TEST_KEY`，或用 `TUNENEST_TEST_CREDENTIAL_FILE` 指向不入库的临时 JSON（以渠道 ID 为键）。不要把凭据写入源码或测试报告；结束后禁用临时 Key 并删除临时文件。
