# TuneNest

网易云音乐与 QQ 音乐歌单整理桌面应用，可按情绪、语种、地区、年代和风格分类歌曲，并创建对应歌单。桌面端由 Tauri 2、React 和 Rust 构成。

QQ 音乐接入仍处于开发验证阶段：扫码后的账号读取和歌单写回尚未经过真实账号端到端验收。此分支是开发快照，不是正式安装包或发布版本。

换电脑继续开发时，先阅读仓库根目录的 [Codex 开发规则](AGENTS.md) 和 [开发交接记录](docs/DEVELOPMENT_HANDOFF.md)。

## 功能

- 基于歌曲标签、歌手名和发行时间进行规则分类
- 可选 AI 分类：Xbot AI 中转站（默认）、DeepSeek、智谱
- 批量创建分类歌单；网易云支持同名歌单追加、替换或跳过，QQ 音乐暂支持追加或跳过
- 两个平台的扫码登录凭据分别保存在系统凭据存储中
- 各 AI 渠道的 API Key 分别保存在 Windows 凭据管理器或 macOS 钥匙串

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

## AI 渠道设置

在桌面应用左侧打开「设置」，选择渠道，填写该渠道的 API Key，保存后点击「测试实际调用」。测试会发起一个小额真实模型请求，只有返回有效内容并通过指令校验才显示成功。AI 分类费用和额度以对应平台显示为准；不设置密钥也可以使用规则分类。

进入「智能歌单分类」会先检查当前渠道是否已配置 Key 并启用 AI。未配置时可选择「去配置 AI 渠道」，保存后接着完成当前流程；也可选择「暂不配置，继续分类」，本次仅使用规则，保留已有 AI 设置。检查本身不调用模型、不消耗额度；开始实际分类前还会复查配置，已明确选择跳过的本次任务不重复提示。

| 渠道 | 内置模型 | 获取 Key |
| --- | --- | --- |
| Xbot AI 中转站（首次使用默认） | `gpt-5.6-luna` | [注册 / 登录](https://newadm.xbotai.cc/sign-up)后点击顶部菜单「TuneNest」→「创建 / 获取 API Key」→复制到 TuneNest 设置 |
| DeepSeek | `deepseek-flash` | [DeepSeek 控制台](https://platform.deepseek.com/api_keys) |
| 智谱 | `glm-4-flash-250414` | [智谱控制台](https://bigmodel.cn/usercenter/proj-mgmt/apikeys)的标准 API Key，非 Coding Plan 专用 Key |

切换渠道会保留其他渠道的密钥。已有 DeepSeek 配置升级后保留该渠道；已保存密钥不会返回到桌面页面。分类缓存按音乐平台、AI 渠道及所选维度隔离。扩展版密钥只存在浏览器本机 storage.local，不再同步到其他电脑。

New API 菜单源码、部署和升级后的刷新步骤见 [部署说明](docs/NEW_API_ONBOARDING.md)。真实调用验证范围见 [开发交接记录](docs/DEVELOPMENT_HANDOFF.md)。
