# TuneNest 开发规则

本文件适用于整个仓库。开始任务前先读 [README.md](README.md) 和 [开发交接记录](docs/DEVELOPMENT_HANDOFF.md)，再核对当前分支、工作区及远程仓库；交接记录是带日期的快照，若与代码冲突，以当前代码和实际测试结果为准。

## 项目边界

- 主要产品是 Tauri 2 + React/TypeScript + Rust 桌面应用；旧 Chrome 扩展仍可单独构建。优先修复桌面主流程，同时保持扩展可构建。
- 网易云音乐和 QQ 音乐通过 `src/adapters/` 的 `MusicPlatformAdapter` 接入。新增平台逻辑放在对应 adapter、API 和 Rust 命令中，不要让某个平台的凭据、ID 或请求混入另一个平台。
- QQ 音乐接入仍是实验功能。代码测试通过不等于真实账号扫码、读取、创建和写入已经验收。网页端非公开接口可能变化，任何相关结论要注明验证范围。
- 听歌排行 Top100 目前只对网易云音乐开放；QQ 的同名功能需要独立实现和验证。

## 代码导航

- `src/panel/App.tsx` 与 `src/panel/pages/`：桌面界面和分类、创建流程。
- `src/adapters/`：平台接口及网易云、QQ 实现；`src/types/index.ts`：共用数据类型。
- `src/api/netease-direct.ts`、`src/api/netease-request.ts`、`src/api/netease-crypto.ts`：桌面网易云请求；`src/api/qq-direct.ts`：QQ 请求、分页和写入校验。
- `src/platform/desktop.ts`：前端 Tauri 命令桥接；`src-tauri/src/lib.rs`、`src-tauri/src/qq.rs`：网络、登录会话与系统凭据存储。
- `src/classifier/`：规则和 AI 分类；`tests/`：现有单元测试。

## 修改约束

- 保持平台选择、缓存键和歌曲来源隔离。QQ 写入需要有效数字歌曲 ID、`songType` 及目标歌单的 `dirId`/`tid`；缺失时停止写入，不要猜测或静默跳过。
- 创建歌单不是幂等操作。请求超时、403 或结果不明时，先读回确认是否已创建，再考虑重试；写入后也要读回确认。不要把仅有 HTTP 200 当成成功。
- 对同名歌单、本人创建的歌单和收藏歌单做明确区分。QQ 暂不提供替换已有歌单；验证写入只使用专门建立的测试歌单，避免改动用户真实歌单。
- 网易云与 QQ 登录凭据以及 DeepSeek API Key 留在系统凭据存储中。不要提交 Cookie、密钥、二维码会话、用户数据、`.dev-webview-profile/` 或构建产物，也不要在日志、测试快照和文档中输出它们。
- Rust 代理只允许指定 HTTPS 域名及路径，并关闭重定向。新增网络接口时审查允许列表、请求大小和响应大小，不要开放任意地址或把密钥暴露给页面代码。
- 修改版本号时同步检查 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 和 `src/platform/desktop.ts`；界面显示的版本要与实际构建一致。

## 开发与验收

- 首次拉取后使用 `npm ci`；桌面调试运行 `npm run dev`。`npm run dev:frontend` 仅启动前端，不能独立验证 Tauri 登录和系统凭据。Windows 需要 Rust 和 WebView2；macOS 构建必须在 macOS 上验证。
- 代码改动至少运行相关测试及 `npm run build:frontend`；Rust 改动运行 `cargo test --manifest-path src-tauri/Cargo.toml --lib` 和 `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`；影响扩展时运行 `npm run extension:build`。
- QQ 接入完成的验收顺序：真实账号扫码并确认身份 → 完整读取本人及收藏歌单和分页歌曲 → 分类预览 → 在专用测试歌单创建/追加少量歌曲 → 读回核对 → 网易云回归。记录每步实际结果；完成前不要标为已验收或制作正式发布包。
- 提交前检查 `git status`、`git diff`、`git diff --check` 和拟提交文件，避免带入个人数据与构建目录。推送目标以实际权限和 `git remote -v` 为准；不要假定当前电脑的 GitHub 账号或远程配置适用于其他电脑。
