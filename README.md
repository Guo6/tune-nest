# TuneNest

网易云音乐与 QQ 音乐歌单整理桌面应用，可按情绪、语种、地区、年代和风格分类歌曲，并创建对应歌单。桌面端由 Tauri 2、React 和 Rust 构成。

QQ 音乐接入仍处于开发验证阶段：扫码后的账号读取和歌单写回尚未经过真实账号端到端验收。此分支是开发快照，不是正式安装包或发布版本。

## 功能

- 基于歌曲标签、歌手名和发行时间进行规则分类
- 可选 DeepSeek AI 分类
- 批量创建分类歌单；网易云支持同名歌单追加、替换或跳过，QQ 音乐暂支持追加或跳过
- 两个平台的扫码登录凭据分别保存在系统凭据存储中
- DeepSeek API Key 保存在 Windows 凭据管理器或 macOS 钥匙串

## 开发桌面版

需要 Node.js、Rust 工具链，以及 Windows 的 WebView2 Runtime（大多数 Windows 10/11 设备已安装）。

```bash
npm install
npm run dev
```

生成当前操作系统的安装包：

```bash
npm run build
```

Windows 构建生成 NSIS 安装程序。Mac 版需要在 macOS 上运行同一命令，生成 DMG；Tauri 使用系统 WebView，因此不需要把 Chromium 一并打包。

## 浏览器扩展版

旧版 Chrome 扩展入口仍保留，可单独构建：

```bash
npm run extension:build
```

然后在 `chrome://extensions/` 打开开发者模式并加载 `dist/` 目录。

## 音乐平台接口说明

网易云新建歌单使用网页端 `weapi` 加密请求，并携带当前登录 Cookie 和 CSRF 令牌。若仍提示 403，请重新扫码并在网易云 App 确认登录。新建请求不会自动连续重试；如果网络异常导致结果不确定，重试前先在网易云检查是否已创建，避免重复歌单。

QQ 音乐使用网页端的非公开接口。开发版提供扫码、歌单读取和写回代码，但真实账号的登录、读回与写入仍需逐项验证；写入后会重新读取目标歌单，未确认生效时不会显示成功。

## DeepSeek 设置

在桌面应用左侧打开「设置」，填写 API Key 并测试连通性。AI 分类费用和额度以 DeepSeek 平台显示为准；不设置密钥也可以使用规则分类。
