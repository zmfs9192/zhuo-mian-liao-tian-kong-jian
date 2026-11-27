# 桌面工具箱 — AI 协作契约（AGENTS.md）

本文档是任何 AI（本地、网页、API）改本项目代码的入口。动手前先读本文档与 `README.md`，再改代码；改完跑自测，再发版。不要凭猜测改。

## 1. 项目与目录

- 项目：桌面工具箱，Windows 桌面程序（Electron），空间之外的电脑端工具。
- 仓库：`zmfs9192/zhuo-mian-liao-tian-kong-jian`，`main` 分支，本项目在仓库的 `desktop-toolbox/` 目录下。
- 发行方式：文件夹发行，解压即用；数据存在 exe 旁边的 `data` 目录（打包后 `userDataDir()` 返回 exe 旁 `data`；开发运行时返回系统用户数据目录）。安装包不由热更新发，只有代码文件走热更新。

## 2. 文件地图（只改该改的文件）

热更新的 5 个代码文件（清单白名单，只有它们能热更新）：

| 文件 | 作用 |
| --- | --- |
| `main.js` | 主进程：窗口、托盘、IPC、工具、更新、Pioneer、Tun、备份等全部后端逻辑 |
| `preload.js` | 预加载桥：`contextBridge` 暴露 `window.toolbox` 的 IPC 调用 |
| `renderer/index.html` | 界面结构：各功能页、设置子页、抽屉与弹窗容器 |
| `renderer/renderer.js` | 渲染层逻辑：页面渲染、事件处理、抽屉、调用主进程 |
| `renderer/styles.css` | 全部样式；玻璃设计 token 在 `:root` |

其他关键文件：

| 文件 | 作用 |
| --- | --- |
| `scripts/gen-manifest.js` | 生成 `update-manifest.json`（按 `package.json` 的版本号算清单） |
| `scripts/publish.js` | 一键发版：算新版本 → 同步两处版本号 → 调 `gen-manifest.js` → 校验清单 |
| `scripts/after-pack.js` | 打包后瘦身（`electron-builder.yml` 的 `afterPack`）：删 `LICENSES.chromium.html`，`locales/` 只留 11 种语言 |
| `scripts/zip-dist.js` | 打包完整文件夹发行 zip（只在需要发安装包时用） |
| `package.json` | 内部版本号唯一来源（`version` 字段）；`main.js` 的 `VERSION` 必须与它一致 |
| `update-manifest.json` | 热更新清单：版本号 + 5 个文件的 sha256 与大小 |
| `update-state.json` | 本机更新状态（不在仓库里，存在 `data` 目录）：上次检查、待重启、备份目录、钉住版本 |
| `electron-builder.yml` | 打包配置：`asar: false`（代码必须以明文文件存在，热更新才能替换）；`extraResources` 只剩 WinTun 包；`afterPack` 指向上面的瘦身脚本 |
| `README.md` | 项目说明；每次发版同步改版本号与修订摘要 |
| `首次运行说明.txt` | 给用户的首次运行说明；每次发版同步改版本号 |
| `redesign-2026-11-27-4.md`、`self-test-2026-11-27-*.md` | 审计方案与自测记录，只读参考 |

## 3. 版本号规则

- 格式：`日期-当日修改次数`，如 `2026-11-27-5`（当天第 5 次改）。内部版用点：`2026.11.27-5`；界面版与 Release tag 用短横：`2026-11-27-5`。换算见 `scripts/gen-manifest.js` 的 `displayVersion`。
- 两处必须一致：`package.json` 的 `version` 与 `main.js` 开头的 `const VERSION` / `const DISPLAY_VERSION`。不一致时 `scripts/publish.js` 会直接拒绝发版。
- 发版只用 `node scripts/publish.js`（或 `npm run publish`）算新版本，不要手改版本号。它会按今天日期加次数递增（跨天从 1 开始），同步改两处，重新生成清单并逐项验哈希，任何一步失败即停。

## 4. 更新机制

- 检查更新：工具箱去 `https://raw.githubusercontent.com/zmfs9192/zhuo-mian-liao-tian-kong-jian/main/desktop-toolbox/update-manifest.json` 拉清单，比对内部版本号；只有比本机新的版本才提示。只手动检查，不自动更新。
- 一键更新：只下载清单里变化的文件，逐个验 sha256，全部通过才替换；替换前把当前 5 个文件备份到 `data/update-backups/<版本>/`，失败按备份全数还原；成功后点「重启生效」。
- 自选本机文件更新：zip 包内含 `update-manifest.json` + 5 个代码文件；解压、读清单、比版本、逐项验 sha256、备份替换，与远程更新同一套逻辑。版本更低需二次确认才降级。
- 一键发布到仓库：仅本地版本高于远端时可点；前置检查令牌、写权限探针、版本同步；发布内容写死 6 个文件（5 个代码文件 + 新生成的清单），二进制与数据文件一律不发；GitHub Contents API 逐文件 PUT，失败即停并报告已写/未写清单。
- 回滚：更新子页显示可回滚版本（备份目录里找，保留最近 2 个版本）；一键回滚恢复备份里有的文件（备份只含那次更新有变化的文件，没动过的文件保持原样），恢复后逐项验哈希，成功提示重启。回滚后被回滚掉的版本会记进 `update-state.json` 的 `pinnedVersion`，检查更新时跳过它；只有比钉住版本更新的版本才再提示。显式更新（远程或本地）成功后钉住自动解除。

## 5. 自测

- 命令：`npm run start:self-test`（即 `electron . --self-test`）。Linux 沙盒需 `DISPLAY=:99`（Xvfb），命令示例见自测记录。`electron . --print-version` 只打印版本号就退出。
- 结果写 `self-test-result.json`；每版写一份 `self-test-YYYY-MM-DD-N.md` 记录实测结果与通过数。
- 自测代码在 `main.js` 的 `runSelfTest` 里；新增功能要在自测里加对应分组，覆盖成功、失败与边界情形。
- 沙盒是 Linux：Tun、winget、真实 GitHub 发布、真 Windows 输入焦点等只能标「未验证」并写验证方法，绝不把没测过的写成已测过。

## 6. 发版步骤

1. 改代码（只改第 2 节列出的文件；数据文件与密钥绝不进仓库）。
2. 跑自测：`npm run start:self-test`，全部新增分组通过，无新增回归。
3. 跑 `node scripts/publish.js`，核对打印的新版本号与清单。
4. 写自测记录 `self-test-YYYY-MM-DD-N.md`；同步改 `README.md` 与 `首次运行说明.txt` 的版本号与修订摘要。
5. 把改动的文件推上 GitHub（`main` 分支，`desktop-toolbox/` 目录）；推完核对远端清单版本号与本地一致。
6. 向用户汇报：改了什么、自测结果、未验证项。安装包只说一声，等用户问你要时再给；不要建 Release，除非用户明确要求。

## 7. 禁止事项

- 凭据与数据绝不进仓库：`config.json` 的 `githubToken`、`agents.json` 的 `apiKey/webToken/webCookie/webUserAgent`、`accounts.json` 的账号密码与代理密码、`pioneer-state.json` 的登录凭据、`data` 目录下的全部 `*.json` 数据文件。备份导出“不含密钥”时必须剥离上述凭据。
- 二进制与生成物不进仓库：`bundled/*.zip`（WinTun、VLC、Chromium 包）、`dist/`、`node_modules/`。快照推送只支持 UTF-8 文本文件。
- 不要改：空间服务端代码（不在 `desktop-toolbox/` 里的文件）、用户本机数据、版本号规则、手动更新原则。
- 不要编造实测结果；不要把推断写成定论；不确定的写「需实测确认」并给验证方法。

## 8. 文案规则

- 界面、提示、日志、更新说明一律用正式、简洁的中文，只说重点，不要照搬用户口语化、亢长的原话。
- 异步操作必须有 Loading、成功提示与失败原因；删除类操作必须有确认框；弹窗/抽屉默认收起，未点操作按钮不许平铺复杂表单。

## 9. 常见坑

- 发版前版本号不一致：`package.json` 与 `main.js` 两处版本号必须先同步，`publish.js` 会校验。
- 清单哈希对不上：`update-manifest.json` 必须由 `gen-manifest.js` 或 `publish.js` 生成，不要手写哈希。
- 仓库是私有的时，检查更新拉清单要带 GitHub 令牌（`config.json` 的 `githubToken`），没配令牌会返回 404。
- 热更新只换 5 个代码文件；Electron 变了要重新打完整文件夹发行包。VLC 与 Chromium 不随包发，改动它们不影响安装包（VLC 缺失时播放器页有后备下载；Chromium 缺失时浏览器页提示下载）。
- 回滚按钮的备份目录名是被更新到的版本，目录里的文件才是回滚后得到的版本（以备份内 `main.js` 的 `VERSION` 为准）。

## 10. 安装包瘦身规则（2026-11-27-6）

- VLC 与 Chromium 不是必备组件，不随安装包发，不给特殊待遇：只放在工具管理的推荐软件里，用户下载后回到播放器/浏览器界面使用；播放器缺 VLC 时仍保留现有的后备下载按钮。
- 安装包里只剩 WinTun 一个内置组件（0.7MB，随包内置，首次运行解压）；`bundled/` 下的 VLC/Chromium 大 zip 只留源码备查，不进仓库也不进安装包。
- 打包后清理的唯一入口是 `scripts/after-pack.js`（`electron-builder.yml` 的 `afterPack`），只做两件事：删 `LICENSES.chromium.html`，`locales/` 只留 11 种语言（`KEEP_LOCALES`：zh-CN、zh-TW、en-US、ja、fr、es、hi、ar、pt-BR、ru、de）。不要在 `zip-dist.js` 或别处再加第二份清理逻辑。
- 有风险的不动：dxcompiler.dll、vk_swiftshader.dll、libGLESv2.dll、d3dcompiler_47.dll 等 GPU 相关文件，ffmpeg.dll、icudtl.dat、resources.pak、v8 快照一律保留。
- exe 文件名是英文 `DesktopToolbox.exe`（`electron-builder.yml` 的 `win.executableName`）：中文 exe 名在用户电脑上解压后不出现，不要改回中文；产品显示名仍是 `productName`（桌面工具箱）。
- 改语言保留清单或清理规则时，同步改 `after-pack.js` 的 `KEEP_LOCALES` 与本节，并重新跑打包自测核对体积。
