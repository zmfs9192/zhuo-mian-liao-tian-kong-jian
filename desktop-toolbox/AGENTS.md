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

> ⚠ **给后来改代码的 AI：版本号规则——日期=当天、末尾每日重置为 0、当天每次修改后 +1（即每天第一次发版是 -1，如 2026-11-28-1）。不要手改版本号，发版只用 `node scripts/publish.js`，它按此规则算新版本：日期取当天（台北时间），与当前版本同一天则最后一位 +1，跨天则从 1 开始。**

- 格式：`日期-当日修改次数`，如 `2026-11-28-1`（当天第 1 次改）。内部版用点：`2026.11.28-1`；界面版与 Release tag 用短横：`2026-11-28-1`。换算见 `scripts/gen-manifest.js` 的 `displayVersion`。
- 两处必须一致：`package.json` 的 `version` 与 `main.js` 开头的 `const VERSION` / `const DISPLAY_VERSION`。不一致时 `scripts/publish.js` 会直接拒绝发版。
- 发版只用 `node scripts/publish.js`（或 `npm run publish`）算新版本，不要手改版本号。它会取当天日期、按上述规则递增，同步改两处，重新生成清单并逐项验哈希，任何一步失败即停。

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
- 自测去噪（2026-11-28-8 起）：`native` 组布尔叶口径，基线 false 已清零（2026-11-28-8：759 项 759 true / 0 false / 16 skip）。环境相关项（Windows-only、未安装项）用 `markSkipped(path, 原因)` 记 skip（结果 JSON 顶层 `skipped` 映射，叶值写字符串 `'skipped'`），不计入 false；网络依赖项一律 mock 或标记。此后任何新增 false 即失败。断言要记正向语义——预期的失败/拒绝（如无 key 拒调、错密码拒导入、本机已是最新版）应断言 `rejected` / `denied` / `upToDate` 等，别把预期值当失败记。
- 数据文件规矩（2026-11-28-8 起）：config.json、agents.json、accounts.json 都带 `version` 字段（当前 v1）；读到未知版本先备份原文件（`.corrupt-<时间戳>`）再按默认处理，不静默覆盖；旧格式（无 version / 裸数组）读到即升版、不丢数据。写数据文件一律走原子写（`writeJsonFile` / `atomicWriteFile`，临时文件 + rename），不裸写 `writeFileSync`。config.json 高频写走 `saveConfig` 单写者队列（500ms 防抖合并），直接读 config 文件前先 `flushConfigNow()`、直接写文件后调 `invalidateConfigCache()`。
- 诊断日志（2026-11-28-8 起）：主进程异常落盘 `data/logs/`（按天、只留 7 天），密钥与令牌必须脱敏（`sanitizeDiagText`，Bearer 正则先于键值正则跑）；诊断包只含版本、自测结果、脱敏日志与更新记录，不含任何密钥，只存本机、不上传。

## 6. 发版步骤

1. 改代码（只改第 2 节列出的文件；数据文件与密钥绝不进仓库）。
2. 跑自测：`npm run start:self-test`，全部新增分组通过，无新增回归（false 必须为 0，见第 5 节）。
3. 跑 `node scripts/publish.js`，核对打印的新版本号与清单（脚本自带发版门禁：版本一致 + 清单齐全，不过即拦；不跑完整自测，通过与否由 CI 与自测记录把关）。
4. 写自测记录 `self-test-YYYY-MM-DD-N.md`；同步改 `README.md` 与 `首次运行说明.txt` 的版本号与修订摘要。
5. 把改动的文件推上 GitHub（`main` 分支，`desktop-toolbox/` 目录）；推完核对远端清单版本号与本地一致。
6. 向用户汇报：改了什么、自测结果、未验证项。安装包只说一声，等用户问你要时再给；不要建 Release，除非用户明确要求。

## 7. 禁止事项

- 凭据与数据绝不进仓库：`config.json` 的 `githubToken`、`agents.json` 的 `apiKey/webToken/webCookie/webUserAgent`、`accounts.json` 的账号密码与代理密码、`pioneer-state.json` 的登录凭据、`data` 目录下的全部 `*.json` 数据文件。备份导出“不含密钥”时必须剥离上述凭据。
- 二进制与生成物不进仓库：`bundled/*.zip`（WinTun、VLC 包）、`dist/`、`node_modules/`。快照推送只支持 UTF-8 文本文件。
- 不要改：空间服务端代码（不在 `desktop-toolbox/` 里的文件）、用户本机数据、版本号规则、手动更新原则。
- 不要编造实测结果；不要把推断写成定论；不确定的写「需实测确认」并给验证方法。

## 8. 文案规则

- 界面、提示、日志、更新说明一律用正式、简洁的中文，只说重点，不要照搬用户口语化、亢长的原话。
- 异步操作必须有 Loading、成功提示与失败原因；删除类操作必须有确认框；弹窗/抽屉默认收起，未点操作按钮不许平铺复杂表单。

## 9. 常见坑

- 发版前版本号不一致：`package.json` 与 `main.js` 两处版本号必须先同步，`publish.js` 会校验。
- 清单哈希对不上：`update-manifest.json` 必须由 `gen-manifest.js` 或 `publish.js` 生成，不要手写哈希。
- 仓库是公开的（2026-11-28 核实），检查更新拉清单不用令牌也能直接拉到；配了 GitHub 令牌（`config.json` 的 `githubToken`）时仍带上它，避免匿名限流。
- 热更新只换 5 个代码文件；Electron 变了要重新打完整文件夹发行包。VLC 不随包发，改动它不影响安装包（VLC 缺失时播放器页有后备下载）。便携版 Chromium 已删除（2026-11-28-2）：浏览器走内嵌 webview，不下载、不装外部二进制，启动时清掉旧版残留的 tools/chromium/。
- 回滚按钮的备份目录名是被更新到的版本，目录里的文件才是回滚后得到的版本（以备份内 `main.js` 的 `VERSION` 为准）。

## 10. 安装包瘦身规则（2026-11-27-6）

- VLC 不是必备组件，不随安装包发，不给特殊待遇。VLC 的去留规则（用户 2026-11-28 亲口定，写死，勿再当回归报）：(1) VLC 只出现在工具管理的推荐软件里，卡片留着，不删；(2) 软件页的已安装列表、自检、安装检测里不出现 VLC；(3) “从软件页拿掉 VLC”指的是 (2) 那些地方，不包括推荐软件。用户下载后回到播放器界面使用；播放器缺 VLC 时仍保留现有的后备下载按钮。自检与安装里不再检测 VLC（2026-11-28-12，第 9 项：它不是默认需要安装项）。便携版 Chromium 已删除（2026-11-28-2）：内嵌浏览器常驻可用，不在推荐软件、自检与安装里出现。
- 安装包里只剩 WinTun 一个内置组件（0.7MB，随包内置，首次运行解压）；`bundled/` 下的 VLC/Chromium 大 zip 只留源码备查，不进仓库也不进安装包。
- 打包后清理的唯一入口是 `scripts/after-pack.js`（`electron-builder.yml` 的 `afterPack`），只做两件事：删 `LICENSES.chromium.html`，`locales/` 只留 11 种语言（`KEEP_LOCALES`：zh-CN、zh-TW、en-US、ja、fr、es、hi、ar、pt-BR、ru、de）。不要在 `zip-dist.js` 或别处再加第二份清理逻辑。
- 有风险的不动：dxcompiler.dll、vk_swiftshader.dll、libGLESv2.dll、d3dcompiler_47.dll 等 GPU 相关文件，ffmpeg.dll、icudtl.dat、resources.pak、v8 快照一律保留。
- exe 文件名是英文 `DesktopToolbox.exe`（`electron-builder.yml` 的 `win.executableName`）：中文 exe 名在用户电脑上解压后不出现，不要改回中文；产品显示名仍是 `productName`（桌面工具箱）。

## 12. 设计系统规范（2026-11-28-5，用户定的长期规矩）

以后生成任何界面/前端代码都严格遵守；改现有界面先按本节检查再动手。

- **布局与比例**：内容驱动容器，严禁表单、卡片、按钮无脑 100% 满宽；输入框与控件按预期内容长度设语义化最大宽度（短字段如验证码/邮编 ≤120px，常规表单 320px–480px，阅读正文行宽 60ch–75ch）；宽屏下关联信息用 CSS Grid/Flex 多列分栏（左右结构或 2–4 列 Bento 网格），消除单列拉长导致的右侧空白；大屏内容区全局最大宽度（如 max-w-6xl 或 1200px）并水平居中。
- **间距**：8pt 网格，内外边距与间距取 4px 倍数阶梯（4, 8, 12, 16, 24, 32, 48, 64px）；亲密性原则，组内间距（4px–8px）明显小于组间（20px–32px），容器内边距至少 16px–24px。
- **色彩**：60-30-10 法则，60% 低饱和度中性背景（浅色 #F8FAFC/#FFFFFF，深色 #09090B/#18181B，严禁大面积纯白配纯黑），30% 次级结构色与边界色，10% 品牌主色仅用于核心 CTA 与激活状态；边界用 1px 低对比度细边框（透明度 8%–12%）或极微弱层级背景色差，抛弃厚重黑框与默认投影。
- **排版**：清晰字阶（主标题高对比深色 + 半粗体 600、正文柔和中性灰 + 400、辅助说明浅灰 12px–13px）；数值、统计、时间启用等宽数字（`font-variant-numeric: tabular-nums`）；图标统一风格线性矢量（Lucide 风格，描边 1.5px–2px，内联 SVG，不要引外部图标字体/CDN），尺寸匹配字号（常规 16px–20px），图标与文字同行 flex 垂直居中，图标色彩亮度略低于文字。
- **交互状态完备**：所有可交互控件同时定义 Default、Hover、Focus-Visible（键盘聚焦环）、Disabled、Loading/Empty（加载骨架屏与空状态引导）。
- **清理规则**：删除所有被注释掉的废弃代码块，不要保留任何 `// TODO` 或历史注释代码（文字版版本历史说明是文档，保留）；删除定义了但从未实际渲染的 state 变量、未调用的函数、未使用的 import、多余的 Props 字段；功能相似的冗余函数或重复的样式定义合并为单一职责的干净实现。删前用 grep 确认每处确实无人引用（自测代码、界面入口、IPC 桥都算引用）；不要删自测还在断言的东西；清理后界面只留当前实际渲染的核心功能，不脑补、不恢复隐藏功能。

## 11. Pioneer 系统代理接管（2026-11-27-8）

- 连接 Pioneer 后不只接管工具箱内嵌浏览器：同时写 Windows 系统代理
  （HKCU `Software\Microsoft\Windows\CurrentVersion\Internet Settings`，
  当前用户级，不用管理员权限）——全局/Tun 走固定代理 127.0.0.1:19352，
  智能走 PAC 文件（`data/pioneer-smart.pac`）；账号分区（无自有代理的）
  也同步接管。实现在 main.js 的 `setWindowsSystemProxy` /
  `pioneerApplyBrowserProxy` / `pioneerResetBrowserProxy`。
- 复位按接管前保存的旧值恢复（`data/pioneer-prev-proxy.json`，只在
  首次接管时保存一次），不是简单关掉，避免清掉用户原来的代理设置；
  没有保存过才关代理、删自动配置。
- 退出时用同步写注册表（`pioneerResetSystemProxySync`，接在
  `before-quit` 里），保证进程退出前复位已落盘；启动时清理上次崩溃
  残留的接管（`pioneerCleanupStaleSystemProxy`，只清指向本地 19352 或
  我们 PAC 的那一种，用户自己设的代理不动）。
- `pioneerEgressProxy()` 绝不能改成 `return null`：它是连 Trojan 节点
  用的上游出口代理（读环境变量 HTTP_PROXY），没有它在公司内网等环境
  下节点根本连不上。
- 注册表命令由纯函数 `windowsSystemProxyCommands` 生成（不执行），自测
  逐条核对；非 Windows 上接管与复位都是空操作。
- 改语言保留清单或清理规则时，同步改 `after-pack.js` 的 `KEEP_LOCALES` 与本节，并重新跑打包自测核对体积。
