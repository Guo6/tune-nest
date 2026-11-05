# TuneNest 开发交接记录

更新日期：2026-11-05（中国标准时间）。这是代码及先前测试的进度快照，不代表发布验收；接手时请先核对 Git 记录和实际运行结果。长期开发约束见仓库根目录 [AGENTS.md](../AGENTS.md)。

## 2026-11-05：v0.1.9 回调兼容修复

- 用户在 v0.1.8 扫码后遇到“QQ 扫码回调地址不受信任”。旧校验仅包含 `ptlogin2.qq.com` 和 `ssl.ptlogin2.qq.com`，漏掉 QQ Connect 的 `ptlogin2.graph.qq.com` 和 `ssl.ptlogin2.graph.qq.com`；本次补齐精确域名，并将路径限定为 `/check_sig`。
- 旧 HTTP 格式仅在域名、端口和路径全部符合要求时转换到指定 HTTPS 地址，再发送登录令牌；保留禁止自动重定向。错误提示不包含回调查询参数，签名请求的网络异常也移除完整 URL。
- `npm test` 17 项、Rust 单元测试 5 项、格式检查及前端生产构建通过；Windows x64 测试安装包为 `src-tauri/target/release/bundle/nsis/TuneNest_0.1.9_x64-setup.exe`，约 2.94 MiB。
- 尚未取得用户此次被拒绝的具体回调域名，也未完成新版本真实账号扫码验收。若仍被拒绝，先读取新版错误中的域名（不要收集完整回调 URL 或令牌），按实际结果继续排查。以下为 2026-11-03 基线记录。

## 仓库与运行

- 上游：`https://github.com/fy-xbot/tune-nest`。当前开发分支位于 fork：`https://github.com/Guo6/tune-nest/tree/codex/desktop-qq-integration`。
- 本次整理前的代码提交：`651d241`（`feat: add desktop app and experimental QQ Music integration`）。换电脑后以 `git log` 为准；文档提交会产生更新的提交号。
- 可从 fork 克隆并切换 `codex/desktop-qq-integration`，安装 Node.js 和 Rust 工具链后运行 `npm ci`、`npm run dev`。Windows 桌面调试还依赖 WebView2 Runtime；macOS 需要在 Mac 上安装 Tauri 所需系统构建工具。`npm run build` 构建当前系统安装包，不是跨平台构建。
- `origin`/`fork` 是本次工作目录里的远程名称，不能保证新电脑一致。此前 `Guo6` 对上游 `fy-xbot/tune-nest` 推送返回 403，所以开发提交推到了 `Guo6` 的 fork 分支。换电脑先运行 `git remote -v` 和 `git status -sb`，再确认目标仓库与写入权限；不要将凭据放入远程 URL。

## 已有实现

- v0.1.8 开发代码：Tauri 桌面主界面、网易云音乐扫码和歌单流程、平台 adapter、QQ 音乐扫码与歌单读写代码。旧浏览器扩展构建入口仍保留。
- 网易云请求由 Rust 进程携带会话凭据发出；前端通过 `src/platform/desktop.ts` 调用。曾针对 403、登录后状态未更新和 Windows 白屏问题调整过流程，仍需以新环境实际操作为准。
- QQ 登录会话和网易云会话分别保存在系统凭据存储中。QQ 代码含分页、同名歌单检查、只写本人普通歌单、业务码检查及写后读回；这些防护已实现，但尚未在真实账号完整验证。
- 分类支持规则和可选 DeepSeek。Top100 仅支持网易云；QQ 暂只提供同名歌单的追加或跳过。

## 验证事实与缺口

- 先前在 Windows 环境运行 `npm test`：17 个测试通过（网易云 15、QQ 2）；`npm run build:frontend`、`npm run extension:build` 通过；`cargo test --manifest-path src-tauri/Cargo.toml --lib`：2 个测试通过；`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` 通过。接手后应重新运行与改动相关的命令。
- 曾测试 QQ 公共二维码获取、未扫码时状态 `66`，以及公共歌单详情的响应。**未验证**真实账号扫码完成、登录身份读取、本人/收藏歌单分页、创建及追加歌曲的完整闭环。
- QQ 接口是网页端非公开接口，可能随平台调整。真实账号测试发现不符时先检查实际响应字段与业务码，再修改解析或写入条件，不要放宽错误检查来掩盖失败。
- v0.1.8 是开发版本，不要把当前分支或本地构建称为已验收的 Windows/macOS 正式版本；macOS 尚需在 Mac 上构建和运行验证。

## 下一步顺序

1. 在开发模式启动桌面应用，确认窗口显示的版本与 `package.json` 一致，并复测网易云登录、歌单读取和创建流程。
2. 用测试账号完成 QQ 扫码；确认手机端授权、桌面端用户身份和会话持久化。若失败，记录不含 Cookie/密钥的状态码与脱敏响应结构。
3. 核对 QQ 本人创建与收藏歌单列表、分页歌曲、`songType`/`dirId`/`tid` 映射和分类结果。
4. 仅在专用测试歌单中尝试少量创建与追加，并读回确认歌曲；验证重复点击或不确定响应不会产生重复歌单或误写。
5. 根据实际结果补测试和文档，再评估 Windows 安装包及 macOS 构建。

## 不要同步到仓库的本机状态

系统凭据存储、登录 Cookie、DeepSeek API Key、`.dev-webview-profile/`、`node_modules/`、`dist/` 和 `src-tauri/target/` 都不能作为跨电脑交接资料。新电脑应重新登录并配置本机密钥。
